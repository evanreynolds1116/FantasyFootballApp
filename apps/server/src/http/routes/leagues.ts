import { DEFAULT_SETTINGS, type Ctx } from "@draft-app/engine";
import { and, count, eq, inArray, or } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { createDraft } from "../../db/createDraft.js";
import { settingsFromRow, settingsToRow } from "../../db/mappers.js";
import { draft, draftSettings, league, player, team, user } from "../../db/schema.js";
import { requireAuth } from "../auth.js";
import { isCommissioner } from "../authz.js";
import {
  findLeagueDraft,
  isLeagueMember,
  leagueExists,
  mergeAndValidateSettings,
  newInviteCode,
  placeholderTeamName,
  rejectIfLocked,
  resizeTeamSlots,
} from "../leagueSetup.js";

const createLeagueBody = z.object({
  name: z.string().trim().min(1).max(80),
  settings: z.record(z.string(), z.unknown()).optional(),
  /** Optional explicit team names; when given, the team count follows their length. Otherwise one placeholder slot per settings.teamCount. */
  teams: z.array(z.object({ name: z.string().trim().min(1).max(40) })).min(1).optional(),
});

const updateLeagueBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

const renameTeamBody = z.object({ name: z.string().trim().min(1).max(40) });

const draftOrderBody = z.object({
  order: z.array(z.object({ teamId: z.string().uuid(), draftNumber: z.number().int().min(1) })).min(1),
});

type Params = { id: string };
type TeamParams = { id: string; teamId: string };

export async function registerLeagueRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  /** Sends 404/403 and returns false unless the caller is the league's commissioner. */
  const requireCommissioner = async (leagueId: string, userId: string, reply: FastifyReply): Promise<boolean> => {
    if (!(await leagueExists(db, leagueId))) {
      await reply.code(404).send({ error: "NOT_FOUND" });
      return false;
    }
    if (!(await isCommissioner(db, userId, leagueId))) {
      await reply.code(403).send({ error: "FORBIDDEN", message: "Only the league commissioner can do this." });
      return false;
    }
    return true;
  };

  app.post("/leagues", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createLeagueBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_BODY", message: parsed.error.message });
    const { name, settings: override, teams: namedTeams } = parsed.data;

    const merged = mergeAndValidateSettings(DEFAULT_SETTINGS, namedTeams ? { ...override, teamCount: namedTeams.length } : override);
    if ("issues" in merged) return reply.code(400).send({ error: "INVALID_SETTINGS", message: merged.issues.join(" "), issues: merged.issues });
    const settings = merged.settings;

    const leagueId = await db.transaction(async (tx) => {
      const [leagueRow] = await tx.insert(league).values({ name, commissionerUserId: request.userId!, inviteCode: newInviteCode() }).returning({ id: league.id });
      const id = leagueRow!.id;
      await tx.insert(draftSettings).values(settingsToRow(id, settings));
      const names = namedTeams?.map((t) => t.name) ?? Array.from({ length: settings.teamCount }, (_, i) => placeholderTeamName(i + 1));
      await tx.insert(team).values(names.map((teamName, i) => ({ leagueId: id, name: teamName, draftNumber: i + 1 })));
      return id;
    });

    const teamRows = await db.select({ id: team.id, draftNumber: team.draftNumber }).from(team).where(eq(team.leagueId, leagueId));
    return reply.send({ leagueId, teams: teamRows.sort((a, b) => a.draftNumber - b.draftNumber) });
  });

  /** Leagues the caller runs or has a team in, newest first. */
  app.get("/leagues", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId!;
    const owned = await db.select({ leagueId: team.leagueId }).from(team).where(eq(team.userId, userId));
    const ownedIds = owned.map((r) => r.leagueId);
    const leagues = await db
      .select({ id: league.id, name: league.name, commissionerUserId: league.commissionerUserId, createdAt: league.createdAt })
      .from(league)
      .where(ownedIds.length > 0 ? or(eq(league.commissionerUserId, userId), inArray(league.id, ownedIds)) : eq(league.commissionerUserId, userId));
    if (leagues.length === 0) return reply.send({ leagues: [] });

    const ids = leagues.map((l) => l.id);
    const [teams, drafts] = await Promise.all([
      db.select({ leagueId: team.leagueId, name: team.name, userId: team.userId }).from(team).where(inArray(team.leagueId, ids)),
      db.select({ id: draft.id, leagueId: draft.leagueId, phase: draft.phase }).from(draft).where(inArray(draft.leagueId, ids)),
    ]);

    return reply.send({
      leagues: leagues
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((l) => {
          const leagueTeams = teams.filter((t) => t.leagueId === l.id);
          const d = drafts.find((x) => x.leagueId === l.id) ?? null;
          return {
            id: l.id,
            name: l.name,
            isCommissioner: l.commissionerUserId === userId,
            myTeamName: leagueTeams.find((t) => t.userId === userId)?.name ?? null,
            teamCount: leagueTeams.length,
            claimedCount: leagueTeams.filter((t) => t.userId !== null).length,
            draft: d ? { id: d.id, phase: d.phase } : null,
          };
        }),
    });
  });

  /** Everything the lobby shows. Members only; the invite code is part of it so any member can re-share the link. */
  app.get("/leagues/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id: leagueId } = request.params as Params;
    const userId = request.userId!;
    const [leagueRow] = await db.select().from(league).where(eq(league.id, leagueId)).limit(1);
    if (!leagueRow) return reply.code(404).send({ error: "NOT_FOUND" });
    if (!(await isLeagueMember(db, userId, leagueId))) return reply.code(403).send({ error: "FORBIDDEN", message: "Join this league with its invite link first." });

    const [[settingsRow], teams, [players], leagueDraft, [commissioner]] = await Promise.all([
      db.select().from(draftSettings).where(eq(draftSettings.leagueId, leagueId)).limit(1),
      db
        .select({ id: team.id, name: team.name, draftNumber: team.draftNumber, userId: team.userId, managerName: user.displayName })
        .from(team)
        .leftJoin(user, eq(user.id, team.userId))
        .where(eq(team.leagueId, leagueId)),
      db.select({ value: count() }).from(player).where(eq(player.leagueId, leagueId)),
      findLeagueDraft(db, leagueId),
      db.select({ displayName: user.displayName }).from(user).where(eq(user.id, leagueRow.commissionerUserId)).limit(1),
    ]);

    return reply.send({
      id: leagueRow.id,
      name: leagueRow.name,
      isCommissioner: leagueRow.commissionerUserId === userId,
      commissionerName: commissioner?.displayName ?? null,
      inviteCode: leagueRow.inviteCode,
      settings: settingsFromRow(settingsRow!),
      teams: teams
        .sort((a, b) => a.draftNumber - b.draftNumber)
        .map((t) => ({ id: t.id, name: t.name, draftNumber: t.draftNumber, claimed: t.userId !== null, managerName: t.managerName, isMine: t.userId === userId })),
      playerCount: players?.value ?? 0,
      draft: leagueDraft,
    });
  });

  /**
   * Commissioner edits name and/or settings before the draft starts. A
   * team-count change adds or removes unclaimed slots. Once the draft has
   * started the settings are locked (SPEC), but the league can still be
   * renamed — a name change alone is allowed at any time.
   */
  app.patch("/leagues/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id: leagueId } = request.params as Params;
    const parsed = updateLeagueBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_BODY", message: parsed.error.message });
    if (!(await requireCommissioner(leagueId, request.userId!, reply))) return;
    if (parsed.data.settings === undefined && parsed.data.name) {
      await db.update(league).set({ name: parsed.data.name }).where(eq(league.id, leagueId));
      return reply.send({ ok: true });
    }
    if (await rejectIfLocked(db, leagueId, reply)) return;

    const [settingsRow] = await db.select().from(draftSettings).where(eq(draftSettings.leagueId, leagueId)).limit(1);
    const merged = mergeAndValidateSettings(settingsFromRow(settingsRow!), parsed.data.settings);
    if ("issues" in merged) return reply.code(400).send({ error: "INVALID_SETTINGS", message: merged.issues.join(" "), issues: merged.issues });

    // Checked up front so a refusal never leaves a half-applied change.
    const teams = await db.select({ userId: team.userId }).from(team).where(eq(team.leagueId, leagueId));
    const unclaimed = teams.filter((t) => t.userId === null).length;
    if (merged.settings.teamCount < teams.length - unclaimed) {
      return reply.code(409).send({
        error: "TEAMS_CLAIMED",
        message: `${teams.length - unclaimed} teams already have managers, so the league can't shrink to ${merged.settings.teamCount}. Release a manager first.`,
      });
    }

    await db.transaction(async (tx) => {
      const resized = await resizeTeamSlots(tx, leagueId, merged.settings.teamCount);
      if (!resized.ok) throw new Error(resized.message);
      await tx.update(draftSettings).set(settingsToRow(leagueId, merged.settings)).where(eq(draftSettings.leagueId, leagueId));
      if (parsed.data.name) await tx.update(league).set({ name: parsed.data.name }).where(eq(league.id, leagueId));
    });
    return reply.send({ ok: true });
  });

  /** Makes a fresh invite code; the old link stops working. */
  app.post("/leagues/:id/invites", { preHandler: requireAuth }, async (request, reply) => {
    const { id: leagueId } = request.params as Params;
    if (!(await requireCommissioner(leagueId, request.userId!, reply))) return;
    const inviteCode = newInviteCode();
    await db.update(league).set({ inviteCode }).where(eq(league.id, leagueId));
    return reply.send({ inviteCode });
  });

  /** A manager renames their own team; the commissioner can rename any (e.g. to tidy a typo). */
  app.patch("/leagues/:id/teams/:teamId", { preHandler: requireAuth }, async (request, reply) => {
    const { id: leagueId, teamId } = request.params as TeamParams;
    const parsed = renameTeamBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_BODY", message: parsed.error.message });
    const userId = request.userId!;
    const [row] = await db.select({ userId: team.userId }).from(team).where(and(eq(team.id, teamId), eq(team.leagueId, leagueId))).limit(1);
    if (!row) return reply.code(404).send({ error: "NOT_FOUND" });
    if (row.userId !== userId && !(await isCommissioner(db, userId, leagueId))) return reply.code(403).send({ error: "FORBIDDEN", message: "This team belongs to another manager." });
    if (await rejectIfLocked(db, leagueId, reply)) return;
    await db.update(team).set({ name: parsed.data.name }).where(eq(team.id, teamId));
    return reply.send({ ok: true });
  });

  /** Commissioner frees a claimed slot (someone grabbed the wrong team, or left). The slot goes back to its placeholder name. */
  app.delete("/leagues/:id/teams/:teamId/manager", { preHandler: requireAuth }, async (request, reply) => {
    const { id: leagueId, teamId } = request.params as TeamParams;
    if (!(await requireCommissioner(leagueId, request.userId!, reply))) return;
    if (await rejectIfLocked(db, leagueId, reply)) return;
    const [row] = await db.select({ draftNumber: team.draftNumber }).from(team).where(and(eq(team.id, teamId), eq(team.leagueId, leagueId))).limit(1);
    if (!row) return reply.code(404).send({ error: "NOT_FOUND" });
    await db.update(team).set({ userId: null, name: placeholderTeamName(row.draftNumber) }).where(eq(team.id, teamId));
    return reply.send({ ok: true });
  });

  /** Manual draft order: must assign every team exactly one of 1..N. */
  app.put("/leagues/:id/draft-order", { preHandler: requireAuth }, async (request, reply) => {
    const { id: leagueId } = request.params as Params;
    const parsed = draftOrderBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_BODY", message: parsed.error.message });
    if (!(await requireCommissioner(leagueId, request.userId!, reply))) return;
    if (await rejectIfLocked(db, leagueId, reply)) return;

    const teams = await db.select({ id: team.id }).from(team).where(eq(team.leagueId, leagueId));
    const order = parsed.data.order;
    const numbers = order.map((o) => o.draftNumber).sort((a, b) => a - b);
    const isPermutation =
      order.length === teams.length &&
      new Set(order.map((o) => o.teamId)).size === teams.length &&
      order.every((o) => teams.some((t) => t.id === o.teamId)) &&
      numbers.every((n, i) => n === i + 1);
    if (!isPermutation) return reply.code(400).send({ error: "INVALID_ORDER", message: "Give every team in the league exactly one number from 1 to the team count." });

    await setDraftOrder(order);
    return reply.send({ ok: true });
  });

  /** SPEC Flow 1 "random shuffle button": the server shuffles, so nobody can claim the commissioner rigged it client-side. */
  app.post("/leagues/:id/draft-order/shuffle", { preHandler: requireAuth }, async (request, reply) => {
    const { id: leagueId } = request.params as Params;
    if (!(await requireCommissioner(leagueId, request.userId!, reply))) return;
    if (await rejectIfLocked(db, leagueId, reply)) return;

    const teams = await db.select({ id: team.id }).from(team).where(eq(team.leagueId, leagueId));
    const numbers = teams.map((_, i) => i + 1);
    for (let i = numbers.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [numbers[i], numbers[j]] = [numbers[j]!, numbers[i]!];
    }
    await setDraftOrder(teams.map((t, i) => ({ teamId: t.id, draftNumber: numbers[i]! })));
    return reply.send({ ok: true });
  });

  async function setDraftOrder(order: { teamId: string; draftNumber: number }[]): Promise<void> {
    // Two-phase update avoids transiently colliding with the (league_id, draft_number) unique index.
    await db.transaction(async (tx) => {
      for (const [i, entry] of order.entries()) await tx.update(team).set({ draftNumber: -(i + 1) }).where(eq(team.id, entry.teamId));
      for (const entry of order) await tx.update(team).set({ draftNumber: entry.draftNumber }).where(eq(team.id, entry.teamId));
    });
  }

  /**
   * Starts the draft: creates the draft row from the league's current
   * settings/teams/players (which locks setup) and applies admin:start
   * through the engine runtime, exactly like the WS intent. Unclaimed teams
   * are allowed — the lobby warns first — but the pool must be big enough to
   * fill every roster, or the snake's auto-pick would run dry.
   */
  app.post("/leagues/:id/start", { preHandler: requireAuth }, async (request, reply) => {
    const { id: leagueId } = request.params as Params;
    const userId = request.userId!;
    if (!(await requireCommissioner(leagueId, userId, reply))) return;

    const [settingsRow] = await db.select().from(draftSettings).where(eq(draftSettings.leagueId, leagueId)).limit(1);
    const settings = settingsFromRow(settingsRow!);
    const [[teamCount], [playerCount]] = await Promise.all([
      db.select({ value: count() }).from(team).where(eq(team.leagueId, leagueId)),
      db.select({ value: count() }).from(player).where(eq(player.leagueId, leagueId)),
    ]);
    const needed = settings.teamCount * settings.rosterSize;
    if ((teamCount?.value ?? 0) !== settings.teamCount) {
      return reply.code(409).send({ error: "TEAM_COUNT_MISMATCH", message: `Settings say ${settings.teamCount} teams but the league has ${teamCount?.value ?? 0}.` });
    }
    if ((playerCount?.value ?? 0) < needed) {
      return reply.code(409).send({
        error: "POOL_TOO_SMALL",
        message: `The player pool has ${playerCount?.value ?? 0} players, but ${settings.teamCount} teams × ${settings.rosterSize} roster spots needs at least ${needed}.`,
      });
    }

    // Serialize concurrent Start taps on the league row so only one draft is ever created.
    const draftId = await db.transaction(async (tx) => {
      await tx.select({ id: league.id }).from(league).where(eq(league.id, leagueId)).for("update");
      const existing = await findLeagueDraft(tx, leagueId);
      if (existing && existing.phase !== "setup") return null;
      return existing?.id ?? (await createDraft(tx, leagueId));
    });
    if (!draftId) return reply.code(409).send({ error: "ALREADY_STARTED", message: "The draft has already started." });

    const ctx: Ctx = { now: Date.now(), rng: Math.random };
    const result = await app.engineRuntime.applyAction(draftId, { type: "admin:start" }, ctx, userId);
    if (result.rejected) {
      // A second Start tap that reached the engine after the first one started it.
      if (result.code === "INVALID_PHASE") return reply.code(409).send({ error: "ALREADY_STARTED", message: "The draft has already started." });
      return reply.code(409).send({ error: result.code, message: result.message });
    }
    return reply.send({ draftId });
  });
}
