import { buildResultsCsv } from "@draft-app/engine";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createDraft } from "../../db/createDraft.js";
import { auditEvent, draft, league } from "../../db/schema.js";
import { toPublicSnapshot } from "../../shared/publicSnapshot.js";
import { requireAuth } from "../auth.js";
import { assertCommissioner, findOwnedTeamId } from "../authz.js";
import { isLeagueMember } from "../leagueSetup.js";

/** "Sunday Night Draft League" -> "sunday-night-draft-league". */
function fileSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "draft";
}

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

  /**
   * FR-18 results export (SPEC: GET /drafts/:id/export.csv): one row per pick
   * with the runner-up bids the reveals showed. Built from the same
   * bid-scrubbed public snapshot every client gets, so a bid that was never
   * revealed can't appear. League members only (the commissioner and every
   * manager); works mid-draft too, as "results so far".
   */
  app.get("/drafts/:id/export.csv", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(404).send({ error: "NOT_FOUND", message: "No such draft." });
    const draftId = parsed.data.id;
    const [row] = await request.server.db
      .select({ leagueId: draft.leagueId, leagueName: league.name, phase: draft.phase })
      .from(draft)
      .innerJoin(league, eq(league.id, draft.leagueId))
      .where(eq(draft.id, draftId))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "NOT_FOUND", message: "No such draft." });
    if (!(await isLeagueMember(request.server.db, request.userId!, row.leagueId))) {
      return reply.code(403).send({ error: "FORBIDDEN", message: "Only the league's managers and commissioner can download its results." });
    }
    const state = await request.server.engineRuntime.getOrHydrate(draftId);
    const csv = buildResultsCsv(toPublicSnapshot(state));
    const filename = `${fileSlug(row.leagueName)}-${row.phase === "complete" ? "results" : "results-so-far"}.csv`;
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(csv);
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
