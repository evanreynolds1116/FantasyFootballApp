import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { player } from "../../db/schema.js";
import { requireAuth } from "../auth.js";
import { isCommissioner } from "../authz.js";
import { isLeagueMember, leagueExists, rejectIfLocked } from "../leagueSetup.js";

const playerInput = z.object({
  name: z.string().trim().min(1).max(80),
  position: z.string().trim().min(1).max(10),
  nflTeam: z.string().trim().max(10).optional(),
  mflId: z.string().trim().max(20).optional(),
  byeWeek: z.number().int().min(1).max(18).optional(),
  /** Only https links: they're shown as images on every screen. */
  photoUrl: z.string().trim().max(500).url().startsWith("https://").optional(),
  status: z.string().optional(),
  custom: z.boolean().optional(),
});

const addPlayersBody = z.object({
  players: z.array(playerInput).min(1).max(5000),
  /** Wipe the pool first — for re-uploading a corrected CSV. */
  replace: z.boolean().optional(),
});

/** Inserts per statement are capped so a full MFL export (a few thousand rows) stays well under Postgres' parameter limit. */
const INSERT_CHUNK = 500;

/** FR-04 player pool (CSV upload / manual add, parsed client-side into JSON rows). All edits lock once the draft exists. */
export async function registerPlayerRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get("/leagues/:id/players", { preHandler: requireAuth }, async (request, reply) => {
    const { id: leagueId } = request.params as { id: string };
    if (!(await leagueExists(db, leagueId))) return reply.code(404).send({ error: "NOT_FOUND" });
    if (!(await isLeagueMember(db, request.userId!, leagueId))) return reply.code(403).send({ error: "FORBIDDEN" });
    const rows = await db
      .select({ id: player.id, name: player.name, position: player.position, nflTeam: player.nflTeam, byeWeek: player.byeWeek, mflId: player.mflId, photoUrl: player.photoUrl, custom: player.custom })
      .from(player)
      .where(eq(player.leagueId, leagueId));
    rows.sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));
    return reply.send({ players: rows });
  });

  app.post("/leagues/:id/players", { preHandler: requireAuth }, async (request, reply) => {
    const { id: leagueId } = request.params as { id: string };
    const parsed = addPlayersBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_BODY", message: parsed.error.message });
    if (!(await leagueExists(db, leagueId))) return reply.code(404).send({ error: "NOT_FOUND" });
    if (!(await isCommissioner(db, request.userId!, leagueId))) return reply.code(403).send({ error: "FORBIDDEN" });
    if (await rejectIfLocked(db, leagueId, reply)) return;

    const rows = parsed.data.players.map((p) => ({ leagueId, ...p, position: p.position.toUpperCase(), custom: p.custom ?? false }));
    const added = await db.transaction(async (tx) => {
      if (parsed.data.replace) await tx.delete(player).where(eq(player.leagueId, leagueId));
      let inserted = 0;
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        // A repeated MFL id (same player twice in one upload, or already in the pool) is skipped rather than failing the whole upload.
        const result = await tx.insert(player).values(rows.slice(i, i + INSERT_CHUNK)).onConflictDoNothing().returning({ id: player.id });
        inserted += result.length;
      }
      return inserted;
    });
    return reply.code(201).send({ ok: true, added, skipped: rows.length - added });
  });

  app.delete("/leagues/:id/players/:playerId", { preHandler: requireAuth }, async (request, reply) => {
    const { id: leagueId, playerId } = request.params as { id: string; playerId: string };
    if (!(await leagueExists(db, leagueId))) return reply.code(404).send({ error: "NOT_FOUND" });
    if (!(await isCommissioner(db, request.userId!, leagueId))) return reply.code(403).send({ error: "FORBIDDEN" });
    if (await rejectIfLocked(db, leagueId, reply)) return;
    const removed = await db.delete(player).where(and(eq(player.id, playerId), eq(player.leagueId, leagueId))).returning({ id: player.id });
    if (removed.length === 0) return reply.code(404).send({ error: "NOT_FOUND" });
    return reply.send({ ok: true });
  });
}
