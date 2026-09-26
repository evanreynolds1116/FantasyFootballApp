import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { league, team, user } from "../../db/schema.js";
import { requireAuth } from "../auth.js";
import { findOwnedTeamId } from "../authz.js";
import { findLeagueDraft } from "../leagueSetup.js";

const claimBody = z.object({
  teamId: z.string().uuid(),
  /** The manager's team name; omitted keeps the slot's current name. */
  name: z.string().trim().min(1).max(40).optional(),
});

async function leagueByCode(app: FastifyInstance, code: string) {
  const [row] = await app.db
    .select({ id: league.id, name: league.name, commissionerUserId: league.commissionerUserId })
    .from(league)
    .where(eq(league.inviteCode, code.toUpperCase()))
    .limit(1);
  return row ?? null;
}

/**
 * FR-02 "Managers join via invite link and claim a team": one reusable code
 * per league (/join/:code). Previewing needs a session (the join page makes
 * one from the manager's name first), but not league membership — the code
 * is the membership ticket.
 */
export async function registerInviteRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get("/invites/:code", { preHandler: requireAuth }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const found = await leagueByCode(app, code);
    if (!found) return reply.code(404).send({ error: "NOT_FOUND", message: "That invite link doesn't work any more. Ask the commissioner for a new one." });

    const [teams, leagueDraft, [commissioner], myTeamId] = await Promise.all([
      db
        .select({ id: team.id, name: team.name, draftNumber: team.draftNumber, userId: team.userId, managerName: user.displayName })
        .from(team)
        .leftJoin(user, eq(user.id, team.userId))
        .where(eq(team.leagueId, found.id)),
      findLeagueDraft(db, found.id),
      db.select({ displayName: user.displayName }).from(user).where(eq(user.id, found.commissionerUserId)).limit(1),
      findOwnedTeamId(db, request.userId!, found.id),
    ]);

    return reply.send({
      leagueId: found.id,
      leagueName: found.name,
      commissionerName: commissioner?.displayName ?? null,
      isCommissioner: found.commissionerUserId === request.userId,
      started: leagueDraft !== null,
      myTeamId,
      teams: teams
        .sort((a, b) => a.draftNumber - b.draftNumber)
        .map((t) => ({ id: t.id, name: t.name, draftNumber: t.draftNumber, claimed: t.userId !== null, managerName: t.managerName })),
    });
  });

  app.post("/invites/:code/claim", { preHandler: requireAuth }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const parsed = claimBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_BODY", message: parsed.error.message });
    const found = await leagueByCode(app, code);
    if (!found) return reply.code(404).send({ error: "NOT_FOUND", message: "That invite link doesn't work any more." });
    if (await findLeagueDraft(db, found.id)) return reply.code(409).send({ error: "LOCKED", message: "The draft has already started." });

    const userId = request.userId!;
    if (await findOwnedTeamId(db, userId, found.id)) {
      return reply.code(409).send({ error: "ALREADY_HAVE_TEAM", message: "You already have a team in this league." });
    }

    let claimed: { id: string }[];
    try {
      // "where user_id is null" makes the claim atomic: two managers racing for one slot can't both win.
      claimed = await db
        .update(team)
        .set({ userId, ...(parsed.data.name ? { name: parsed.data.name } : {}) })
        .where(and(eq(team.id, parsed.data.teamId), eq(team.leagueId, found.id), isNull(team.userId)))
        .returning({ id: team.id });
    } catch (err) {
      // team_league_user_idx: the same user claimed another slot in a parallel request.
      if ((err as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "ALREADY_HAVE_TEAM", message: "You already have a team in this league." });
      }
      throw err;
    }
    if (claimed.length === 0) return reply.code(409).send({ error: "TEAM_TAKEN", message: "Someone else just claimed that team. Pick another." });
    return reply.send({ leagueId: found.id, teamId: parsed.data.teamId });
  });
}
