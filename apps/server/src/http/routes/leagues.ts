import { DEFAULT_SETTINGS, type DraftSettings } from "@draft-app/engine";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { settingsToRow } from "../../db/mappers.js";
import { draftSettings, league, player, team } from "../../db/schema.js";
import { requireAuth } from "../auth.js";
import { assertCommissioner } from "../authz.js";

const createLeagueBody = z.object({
  name: z.string().min(1),
  settings: z.record(z.string(), z.unknown()).optional(),
  teams: z.array(z.object({ name: z.string().min(1) })).min(1),
});

const addPlayersBody = z.object({
  players: z
    .array(
      z.object({
        name: z.string().min(1),
        position: z.string().min(1),
        nflTeam: z.string().optional(),
        mflId: z.string().optional(),
        byeWeek: z.number().int().optional(),
        status: z.string().optional(),
        custom: z.boolean().optional(),
      }),
    )
    .min(1),
});

const draftOrderBody = z.object({
  order: z.array(z.object({ teamId: z.string().uuid(), draftNumber: z.number().int().min(1) })).min(1),
});

export async function registerLeagueRoutes(app: FastifyInstance): Promise<void> {
  app.post("/leagues", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createLeagueBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_BODY", message: parsed.error.message });
    const { name, settings: settingsOverride, teams } = parsed.data;

    const mergedSettings: DraftSettings = { ...DEFAULT_SETTINGS, ...(settingsOverride as Partial<DraftSettings> | undefined) };

    const db = request.server.db;
    const leagueId = await db.transaction(async (tx) => {
      const [leagueRow] = await tx.insert(league).values({ name, commissionerUserId: request.userId! }).returning({ id: league.id });
      const id = leagueRow!.id;
      await tx.insert(draftSettings).values(settingsToRow(id, mergedSettings));
      await tx.insert(team).values(
        teams.map((t, i) => ({ leagueId: id, name: t.name, draftNumber: i + 1 })),
      );
      return id;
    });

    const teamRows = await db.select({ id: team.id, draftNumber: team.draftNumber }).from(team).where(eq(team.leagueId, leagueId));
    return reply.send({ leagueId, teams: teamRows.sort((a, b) => a.draftNumber - b.draftNumber) });
  });

  app.post("/leagues/:id/players", { preHandler: requireAuth }, async (request, reply) => {
    const { id: leagueId } = request.params as { id: string };
    const parsed = addPlayersBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_BODY", message: parsed.error.message });

    try {
      await assertCommissioner(request.server.db, request.userId!, leagueId);
    } catch {
      return reply.code(403).send({ error: "FORBIDDEN" });
    }

    await request.server.db.insert(player).values(
      parsed.data.players.map((p) => ({ leagueId, ...p, custom: p.custom ?? false })),
    );
    return reply.code(201).send({ ok: true });
  });

  app.put("/leagues/:id/draft-order", { preHandler: requireAuth }, async (request, reply) => {
    const { id: leagueId } = request.params as { id: string };
    const parsed = draftOrderBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_BODY", message: parsed.error.message });

    try {
      await assertCommissioner(request.server.db, request.userId!, leagueId);
    } catch {
      return reply.code(403).send({ error: "FORBIDDEN" });
    }

    // Two-phase update avoids transiently colliding with the (league_id, draft_number) unique index.
    await request.server.db.transaction(async (tx) => {
      for (const [i, entry] of parsed.data.order.entries()) {
        await tx.update(team).set({ draftNumber: -(i + 1) }).where(eq(team.id, entry.teamId));
      }
      for (const entry of parsed.data.order) {
        await tx.update(team).set({ draftNumber: entry.draftNumber }).where(eq(team.id, entry.teamId));
      }
    });

    return reply.send({ ok: true });
  });
}
