import { describe, it, expect } from "vitest";
import { makeCtx, makePlayerPool, makeState, nominateFullRound } from "../helpers.js";
import { applyAdminStart } from "../../src/rules/start.js";
import { applyNominate } from "../../src/rules/nomination.js";
import { applyBidSubmit } from "../../src/rules/bidding.js";
import { applyLotExpired } from "../../src/rules/reveal.js";
import { applyAdminUndo } from "../../src/rules/undo.js";
import { applyAdminBreak, applyAdminResume, BACK_IN_MS } from "../../src/rules/pauseResume.js";
import { revealDurationMs } from "../../src/revealShow.js";
import { beginSnake, applyPickMake } from "../../src/rules/snake.js";
import type { DraftState } from "../../src/model/types.js";
import { remainingBudget } from "../../src/selectors/budget.js";
import { isPlayerAvailable } from "../../src/selectors/lots.js";

describe("undo", () => {
  it("rejects when there is nothing to undo", () => {
    const players = makePlayerPool("QB", 5);
    const state: DraftState = makeState({ teamCount: 2, players });
    const ctx = makeCtx(1000);
    const res = applyAdminUndo(state, { type: "admin:undo" }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "NOTHING_TO_UNDO" });
  });

  it("undoes an auction award per SPEC: pick removed, budget restored, player back in the pool, draft paused", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    let i = 0;
    state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
    const lot = state.lots[0]!;
    const budgetBefore = remainingBudget(state, "t1");
    state = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 50 }, ctx).state;
    state = applyLotExpired(state, { type: "clock:lotExpired", lotId: lot.id }, ctx).state;
    expect(state.picks.some((p) => p.playerId === lot.playerId)).toBe(true);
    expect(remainingBudget(state, "t1")).toBe(budgetBefore - 50);

    const res = applyAdminUndo(state, { type: "admin:undo" }, ctx);
    expect(res.events).toContainEqual({ type: "draft:undo", undone: { kind: "award", teamId: "t1", playerId: lot.playerId } });
    expect(res.state.picks.some((p) => p.playerId === lot.playerId)).toBe(false);
    expect(remainingBudget(res.state, "t1")).toBe(budgetBefore);
    const undoneLot = res.state.lots.find((l) => l.id === lot.id)!;
    expect(undoneLot.state).toBe("returnedToPool");
    expect(undoneLot.winnerTeamId).toBeNull();
    expect(undoneLot.price).toBeNull();
    expect(isPlayerAvailable(res.state, lot.playerId)).toBe(true);
    expect(res.state.paused).toBe(true);
    expect(res.state.lastAwardOrPick).toBeNull();
  });

  it("undoing an award after the next lot opened pauses that lot and never reopens the undone one", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17, bidClockSec: 60 } });
    state = applyAdminStart(state, { type: "admin:start" }, makeCtx(1000)).state;
    let i = 0;
    state = nominateFullRound(state, makeCtx(1000), () => players[i++]!.id, applyNominate);
    const [lotA, lotB] = state.lots;
    state = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lotA!.id, amount: 50 }, makeCtx(1000)).state;
    state = applyLotExpired(state, { type: "clock:lotExpired", lotId: lotA!.id }, makeCtx(2000)).state;
    const liveB = state.lots.find((l) => l.id === lotB!.id)!;
    expect(liveB.state).toBe("open");
    const endsAt = liveB.endsAt!;

    // Undo 10 s into lot B's clock, which starts once lot A's reveal has played.
    const undoAt = 2000 + revealDurationMs([{ teamId: "t1", amount: 50 }], "t1") + 10_000;
    const res = applyAdminUndo(state, { type: "admin:undo" }, makeCtx(undoAt));
    // SPEC key constraint: one open lot per draft at a time.
    const liveLots = res.state.lots.filter((l) => l.state === "open" || l.state === "tieRebid" || l.state === "paused");
    expect(liveLots.map((l) => l.id)).toEqual([lotB!.id]);
    const frozenB = res.state.lots.find((l) => l.id === lotB!.id)!;
    expect(frozenB.endsAt).toBeNull();
    expect(frozenB.remainingMs).toBe(endsAt - undoAt);
    expect(res.state.paused).toBe(true);
    expect(res.events.map((e) => e.type)).toEqual(["draft:paused", "draft:undo"]);

    // Resume picks lot B back up with the time it had left.
    const resumed = applyAdminResume(res.state, { type: "admin:resume" }, makeCtx(90_000)).state;
    const resumedB = resumed.lots.find((l) => l.id === lotB!.id)!;
    expect(resumedB.state).toBe("open");
    expect(resumedB.endsAt).toBe(90_000 + BACK_IN_MS + (endsAt - undoAt));
    expect(resumed.lots.find((l) => l.id === lotA!.id)?.state).toBe("returnedToPool");
  });

  it("a winner the award had filled up becomes eligible again for the live lot after undo", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 1, rosterSize: 17, positionGroups: null } });
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    let i = 0;
    state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
    const [lotA, lotB] = state.lots;
    state = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lotA!.id, amount: 50 }, ctx).state;
    state = applyLotExpired(state, { type: "clock:lotExpired", lotId: lotA!.id }, ctx).state;
    expect(state.lots.find((l) => l.id === lotB!.id)!.eligibleTeamIds).not.toContain("t1");

    state = applyAdminUndo(state, { type: "admin:undo" }, ctx).state;
    expect(state.lots.find((l) => l.id === lotB!.id)!.eligibleTeamIds).toContain("t1");
    state = applyAdminResume(state, { type: "admin:resume" }, ctx).state;
    const res = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lotB!.id, amount: 20 }, ctx);
    expect(res.events[0]).not.toMatchObject({ type: "draft:rejected" });
  });

  it("undo during a timed break leaves the break and the frozen clock exactly as they were", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    let i = 0;
    state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
    const lotA = state.lots[0]!;
    state = applyLotExpired(state, { type: "clock:lotExpired", lotId: lotA.id }, ctx).state;
    state = applyAdminBreak(state, { type: "admin:break", minutes: 10 }, makeCtx(2000)).state;
    const frozenBefore = state.lots[1]!.remainingMs;

    const res = applyAdminUndo(state, { type: "admin:undo" }, makeCtx(90_000));
    expect(res.state.paused).toBe(true);
    expect(res.state.breakEndsAt).toBe(2000 + 10 * 60_000);
    expect(res.state.lots[1]!.remainingMs).toBe(frozenBefore);
    expect(res.events.map((e) => e.type)).toEqual(["draft:undo"]);
  });

  it("undoes a snake pick: pick removed, no lot involved, player back in the pool", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({
      teamCount: 2,
      players,
      settings: { auctionSpots: 0, rosterSize: 1, positionGroups: null },
    });
    const ctx = makeCtx(1000);
    state = beginSnake(state, ctx).state;
    state = applyPickMake(state, { type: "pick:make", teamId: "t1", playerId: "qb1" }, ctx).state;
    expect(state.picks).toHaveLength(1);

    const res = applyAdminUndo(state, { type: "admin:undo" }, ctx);
    expect(res.events).toContainEqual({ type: "draft:undo", undone: { kind: "pick", teamId: "t1", playerId: "qb1" } });
    expect(res.state.picks).toHaveLength(0);
    expect(res.state.lots).toHaveLength(0);
    expect(res.state.paused).toBe(false);
  });

  it("undo only reverses the single most-recent pick; a second undo targets the prior one", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({
      teamCount: 2,
      players,
      settings: { auctionSpots: 0, rosterSize: 2, positionGroups: null },
    });
    const ctx = makeCtx(1000);
    state = beginSnake(state, ctx).state;
    state = applyPickMake(state, { type: "pick:make", teamId: "t1", playerId: "qb1" }, ctx).state;
    state = applyPickMake(state, { type: "pick:make", teamId: "t2", playerId: "qb2" }, ctx).state;
    expect(state.picks.map((p) => p.playerId)).toEqual(["qb1", "qb2"]);

    let res = applyAdminUndo(state, { type: "admin:undo" }, ctx);
    expect(res.state.picks.map((p) => p.playerId)).toEqual(["qb1"]);
    res = applyAdminUndo(res.state, { type: "admin:undo" }, ctx);
    expect(res.state.picks.map((p) => p.playerId)).toEqual([]);
  });

  it("after undo, the player can be nominated again by any team, not just the original winner", () => {
    const players = makePlayerPool("QB", 6);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    let i = 0;
    state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
    const [lotA, lotB] = state.lots;
    state = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lotA!.id, amount: 50 }, ctx).state;
    state = applyLotExpired(state, { type: "clock:lotExpired", lotId: lotA!.id }, ctx).state;
    state = applyAdminUndo(state, { type: "admin:undo" }, ctx).state;
    state = applyAdminResume(state, { type: "admin:resume" }, ctx).state;
    state = applyLotExpired(state, { type: "clock:lotExpired", lotId: lotB!.id }, ctx).state;

    // Round 2 nominations: whoever is up can nominate the undone player.
    expect(state.nominationTurnTeamId).not.toBeNull();
    const res = applyNominate(state, { type: "nominate", teamId: state.nominationTurnTeamId!, playerId: lotA!.playerId }, ctx);
    expect(res.events[0]).not.toMatchObject({ type: "draft:rejected" });
  });

  it("nothing to undo after a pick has already been undone once and no further picks exist", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({
      teamCount: 1,
      players,
      settings: { auctionSpots: 0, rosterSize: 1, positionGroups: null },
    });
    const ctx = makeCtx(1000);
    state = beginSnake(state, ctx).state;
    state = applyPickMake(state, { type: "pick:make", teamId: "t1", playerId: "qb1" }, ctx).state;
    state = applyAdminUndo(state, { type: "admin:undo" }, ctx).state;
    const res = applyAdminUndo(state, { type: "admin:undo" }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "NOTHING_TO_UNDO" });
  });

  it("rejects NOTHING_TO_UNDO if lastAwardOrPick points at a pick that no longer exists", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 1, players });
    state = { ...state, lastAwardOrPick: { kind: "pick", pickId: "does-not-exist" } };
    const ctx = makeCtx(1000);
    const res = applyAdminUndo(state, { type: "admin:undo" }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "NOTHING_TO_UNDO" });
  });

  it("undoing twice in a row where both the most-recent and prior picks are auction awards returns both players to the pool", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    let i = 0;
    state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
    const [lotA, lotB] = state.lots;
    state = applyLotExpired(state, { type: "clock:lotExpired", lotId: lotA!.id }, ctx).state;
    state = applyLotExpired(state, { type: "clock:lotExpired", lotId: lotB!.id }, ctx).state;
    expect(state.picks).toHaveLength(2);

    state = applyAdminUndo(state, { type: "admin:undo" }, ctx).state;
    expect(state.lots.find((l) => l.id === lotB!.id)?.state).toBe("returnedToPool");
    expect(state.lots.find((l) => l.id === lotA!.id)?.state).toBe("awarded");

    const res = applyAdminUndo(state, { type: "admin:undo" }, ctx);
    expect(res.state.lots.find((l) => l.id === lotA!.id)?.state).toBe("returnedToPool");
    expect(res.state.picks).toHaveLength(0);
    expect(isPlayerAvailable(res.state, lotA!.playerId)).toBe(true);
    expect(isPlayerAvailable(res.state, lotB!.playerId)).toBe(true);
  });
});
