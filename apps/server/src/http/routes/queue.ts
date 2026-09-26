import type { Ctx } from "@draft-app/engine";
import { MAX_QUEUE_LENGTH } from "@draft-app/engine";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { player, teamQueue } from "../../db/schema.js";
import { requireAuth } from "../auth.js";
import { findOwnedTeamId } from "../authz.js";
import { findLeagueDraft } from "../leagueSetup.js";

const queueBody = z.object({ playerIds: z.array(z.string().uuid()).max(500) });

/**
 * A manager's own ranked queue (FR-19), from the lobby. Private: you can only
 * read or write the queue of the team you own. Before the draft exists it's
 * written straight to team_queue; once the draft exists, an edit goes through
 * the engine (the same `queue:update` action the draft screen sends), so the
 * live draft state and the table never disagree.
 */
export async function registerQueueRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get("/leagues/:id/queue", { preHandler: requireAuth }, async (request, reply) => {
    const { id: leagueId } = request.params as { id: string };
    const teamId = await findOwnedTeamId(db, request.userId!, leagueId);
    if (!teamId) return reply.code(403).send({ error: "FORBIDDEN", message: "You don't have a team in this league." });
    const [row] = await db.select({ playerIds: teamQueue.playerIds }).from(teamQueue).where(eq(teamQueue.teamId, teamId)).limit(1);
    return reply.send({ teamId, playerIds: (row?.playerIds as string[] | undefined) ?? [] });
  });

  app.put("/leagues/:id/queue", { preHandler: requireAuth }, async (request, reply) => {
    const { id: leagueId } = request.params as { id: string };
    const parsed = queueBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_BODY", message: parsed.error.message });
    const teamId = await findOwnedTeamId(db, request.userId!, leagueId);
    if (!teamId) return reply.code(403).send({ error: "FORBIDDEN", message: "You don't have a team in this league." });

    const playerIds = [...new Set(parsed.data.playerIds)];
    if (playerIds.length > MAX_QUEUE_LENGTH) {
      return reply.code(400).send({ error: "INVALID_QUEUE", message: `A queue can hold at most ${MAX_QUEUE_LENGTH} players.` });
    }

    const draftRow = await findLeagueDraft(db, leagueId);
    if (draftRow) {
      const ctx: Ctx = { now: Date.now(), rng: Math.random };
      const result = await app.engineRuntime.applyAction(draftRow.id, { type: "queue:update", teamId, playerIds }, ctx, request.userId!);
      if (result.rejected) return reply.code(400).send({ error: result.code, message: result.message });
      return reply.send({ teamId, playerIds });
    }

    if (playerIds.length > 0) {
      const known = await db.select({ id: player.id }).from(player).where(and(eq(player.leagueId, leagueId), inArray(player.id, playerIds)));
      if (known.length !== playerIds.length) {
        return reply.code(400).send({ error: "INVALID_QUEUE", message: "The queue has a player who isn't in this league's pool." });
      }
    }
    await db
      .insert(teamQueue)
      .values({ teamId, playerIds })
      .onConflictDoUpdate({ target: teamQueue.teamId, set: { playerIds, updatedAt: new Date() } });
    return reply.send({ teamId, playerIds });
  });
}
