import { DEFAULT_SETTINGS, reduce, type Ctx } from "@draft-app/engine";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/buildServer.js";
import { createDraft } from "../src/db/createDraft.js";
import { loadDraftState } from "../src/db/loadDraftState.js";
import { persistReduceResult } from "../src/db/persistReduceResult.js";
import { draft, draftSettings, league, player, team, user } from "../src/db/schema.js";

describe("persistence round-trip (no network layer)", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let leagueId: string;
  let userId: string;
  let teamIds: string[];

  beforeAll(async () => {
    app = await buildServer();
    const db = app.db;

    const [userRow] = await db.insert(user).values({ displayName: "Commish" }).returning({ id: user.id });
    userId = userRow!.id;

    const [leagueRow] = await db.insert(league).values({ name: "Persistence Test League", commissionerUserId: userId }).returning({ id: league.id });
    leagueId = leagueRow!.id;

    await db.insert(draftSettings).values({
      leagueId,
      teamCount: 2,
      budget: DEFAULT_SETTINGS.startingBudget,
      auctionSpots: 2,
      rosterSize: 2,
      minBid: DEFAULT_SETTINGS.minBid,
      bidStep: DEFAULT_SETTINGS.bidStep,
      tieMinRaise: DEFAULT_SETTINGS.tieMinRaise,
      earlyClose: DEFAULT_SETTINGS.earlyClose,
      maxTieRounds: null,
      tieFallback: DEFAULT_SETTINGS.tieFallback,
      noBidAction: DEFAULT_SETTINGS.noBidAction,
      nominationOrder: DEFAULT_SETTINGS.nominationOrder,
      revealTopN: "3",
      pickExpiryAction: DEFAULT_SETTINGS.pickExpiryAction,
      brokeTeamsFillAtEnd: DEFAULT_SETTINGS.brokeTeamsFillAtEnd,
      positionGroups: null,
    });

    const teamRows = await db.insert(team).values([
      { leagueId, name: "Team A", draftNumber: 1 },
      { leagueId, name: "Team B", draftNumber: 2 },
    ]).returning({ id: team.id });
    teamIds = teamRows.map((r) => r.id);

    await db.insert(player).values([
      { leagueId, name: "Player One", position: "QB" },
      { leagueId, name: "Player Two", position: "RB" },
    ]);
  });

  afterAll(async () => {
    // Delete drafts (cascades lot/bid/pick/audit_event) before the league
    // (cascades team/player/draft_settings) — team/player have non-cascading
    // FK paths from bid/lot/pick, so the reverse order trips a FK violation.
    await app.db.delete(draft).where(eq(draft.leagueId, leagueId));
    await app.db.delete(league).where(eq(league.id, leagueId));
    await app.db.delete(user).where(eq(user.id, userId));
    await app.close();
  });

  it("createDraft seeds a draft row whose loaded state matches the engine's own initial state shape", async () => {
    const draftId = await createDraft(app.db, leagueId);
    const state = await loadDraftState(app.db, draftId);

    expect(state.phase).toBe("setup");
    expect(state.version).toBe(0);
    expect(state.teams.map((t) => t.id).sort()).toEqual([...teamIds].sort());
    expect(state.players).toHaveLength(2);
    expect(state.settings.teamCount).toBe(2);
    expect(state.settings.auctionSpots).toBe(2);
    expect(state.lots).toEqual([]);
    expect(state.bids).toEqual([]);
    expect(state.picks).toEqual([]);
  });

  it("round-trips a reduce() call through persist + load, including lots/bids/picks", async () => {
    const draftId = await createDraft(app.db, leagueId);
    let state = await loadDraftState(app.db, draftId);
    const ctx: Ctx = { now: 1_700_000_000_000, rng: () => 0.5 };

    // admin:start
    let result = reduce(state, { type: "admin:start" }, ctx);
    await persistReduceResult(app.db, draftId, userId, { type: "admin:start" }, state, result);
    state = result.state;

    let reloaded = await loadDraftState(app.db, draftId);
    expect(reloaded.phase).toBe("auction");
    expect(reloaded.nominationTurnTeamId).toBe(state.nominationTurnTeamId);
    expect(reloaded.nominationEndsAt).toBe(state.nominationEndsAt);

    // nominate for both teams to open lot 1
    const [t1, t2] = state.teams.slice().sort((a, b) => a.draftNumber - b.draftNumber);
    const [p1, p2] = state.players;
    const nominateAction1 = { type: "nominate" as const, teamId: t1!.id, playerId: p1!.id };
    result = reduce(state, nominateAction1, ctx);
    await persistReduceResult(app.db, draftId, userId, nominateAction1, state, result);
    state = result.state;

    const nominateAction2 = { type: "nominate" as const, teamId: t2!.id, playerId: p2!.id };
    result = reduce(state, nominateAction2, ctx);
    await persistReduceResult(app.db, draftId, userId, nominateAction2, state, result);
    state = result.state;

    reloaded = await loadDraftState(app.db, draftId);
    expect(reloaded.lots).toHaveLength(2);
    expect(reloaded.lots[0]?.state).toBe("open");
    expect(reloaded.lots[0]?.eligibleTeamIds.sort()).toEqual(state.lots[0]!.eligibleTeamIds.slice().sort());

    // bid, then let the lot expire (no-bid award path) to exercise the picks table
    const lotId = state.lots[0]!.id;
    const bidAction = { type: "bid:submit" as const, teamId: t1!.id, lotId, amount: 25 };
    result = reduce(state, bidAction, ctx);
    await persistReduceResult(app.db, draftId, userId, bidAction, state, result);
    state = result.state;

    reloaded = await loadDraftState(app.db, draftId);
    const reloadedBid = reloaded.bids.find((b) => b.teamId === t1!.id && b.lotId === lotId);
    expect(reloadedBid?.amount).toBe(25);
    expect(reloadedBid?.superseded).toBe(false);

    const expireAction = { type: "clock:lotExpired" as const, lotId };
    result = reduce(state, expireAction, { now: ctx.now + 60_000, rng: ctx.rng });
    await persistReduceResult(app.db, draftId, userId, expireAction, state, result);
    state = result.state;

    reloaded = await loadDraftState(app.db, draftId);
    expect(reloaded.picks).toHaveLength(1);
    expect(reloaded.picks[0]?.teamId).toBe(t1!.id);
    expect(reloaded.picks[0]?.price).toBe(25);
    expect(reloaded.lots.find((l) => l.id === lotId)?.state).toBe("awarded");
    expect(reloaded.version).toBe(state.version);
  });

  it("skips persistence entirely for a rejected action (state unchanged)", async () => {
    const draftId = await createDraft(app.db, leagueId);
    const state = await loadDraftState(app.db, draftId);
    const ctx: Ctx = { now: Date.now(), rng: Math.random };

    const badAction = { type: "nominate" as const, teamId: state.teams[0]!.id, playerId: state.players[0]!.id };
    const result = reduce(state, badAction, ctx); // still "setup" phase -> INVALID_PHASE rejection
    expect(result.events[0]).toMatchObject({ type: "draft:rejected", code: "INVALID_PHASE" });
    expect(result.state).toBe(state);

    // Confirm nothing changed in the DB (version still 0, no lots).
    const reloaded = await loadDraftState(app.db, draftId);
    expect(reloaded.version).toBe(0);
    expect(reloaded.lots).toEqual([]);
  });
});
