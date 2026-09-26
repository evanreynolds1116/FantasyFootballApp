import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createDraft } from "../../db/createDraft.js";
import { auditEvent, draft } from "../../db/schema.js";
import { toPublicSnapshot } from "../../shared/publicSnapshot.js";
import { requireAuth } from "../auth.js";
import { assertCommissioner, findOwnedTeamId } from "../authz.js";

export async function registerDraftRoutes(app: FastifyInstance): Promise<void> {
  app.post("/leagues/:id/drafts", { preHandler: requireAuth }, async (request, reply) => {
    const { id: leagueId } = request.params as { id: string };
    try {
      await assertCommissioner(request.server.db, request.userId!, leagueId);
    } catch {
      return reply.code(403).send({ error: "FORBIDDEN" });
    }
    const draftId = await createDraft(request.server.db, leagueId);
    return reply.code(201).send({ draftId });
  });

  // Read-only: any authenticated participant (including spectators) may view state.
  app.get("/drafts/:id/state", { preHandler: requireAuth }, async (request, reply) => {
    const { id: draftId } = request.params as { id: string };
    const state = await request.server.engineRuntime.getOrHydrate(draftId);
    const [row] = await request.server.db.select({ leagueId: draft.leagueId }).from(draft).where(eq(draft.id, draftId)).limit(1);
    const myTeamId = row ? await findOwnedTeamId(request.server.db, request.userId!, row.leagueId) : null;
    return reply.send(toPublicSnapshot(state, myTeamId));
  });

  // Commissioner-only for now: audit rows store the full Action, which can include
  // hidden bid amounts pre-reveal. Scrubbing pre-reveal amounts for broader access
  // is deferred — this endpoint exists in phase 2 mainly to verify persistence.
  app.get("/drafts/:id/log", { preHandler: requireAuth }, async (request, reply) => {
    const { id: draftId } = request.params as { id: string };
    const [row] = await request.server.db.select({ leagueId: draft.leagueId }).from(draft).where(eq(draft.id, draftId)).limit(1);
    if (!row) return reply.code(404).send({ error: "NOT_FOUND" });
    try {
      await assertCommissioner(request.server.db, request.userId!, row.leagueId);
    } catch {
      return reply.code(403).send({ error: "FORBIDDEN" });
    }
    const events = await request.server.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.draftId, draftId))
      .orderBy(auditEvent.seq);
    return reply.send({ events });
  });
}
