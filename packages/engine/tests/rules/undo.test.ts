import { describe, it, expect } from "vitest";
import { makeCtx, makePlayerPool, makeState, nominateFullRound } from "../helpers.js";
import { applyAdminStart } from "../../src/rules/start.js";
import { applyNominate } from "../../src/rules/nomination.js";
import { applyBidSubmit } from "../../src/rules/bidding.js";
import { applyLotExpired } from "../../src/rules/reveal.js";
import { applyAdminUndo } from "../../src/rules/undo.js";
import { applyAdminResume } from "../../src/rules/pauseResume.js";
import { beginSnake, applyPickMake } from "../../src/rules/snake.js";
import type { DraftState } from "../../src/model/types.js";

describe("undo", () => {
  it("rejects when there is nothing to undo", () => {
    const players = makePlayerPool("QB", 5);
    const state: DraftState = makeState({ teamCount: 2, players });
    const ctx = makeCtx(1000);
    const res = applyAdminUndo(state, { type: "admin:undo" }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "NOTHING_TO_UNDO" });
  });

  it("undoes an auction award: pick removed, lot reopened paused, player back in the pool", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    let i = 0;
    state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
    const lot = state.lots[0]!;
    state = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 50 }, ctx).state;
    state = applyLotExpired(state, { type: "clock:lotExpired", lotId: lot.id }, ctx).state;
    expect(state.picks.some((p) => p.playerId === lot.playerId)).toBe(true);

    const res = applyAdminUndo(state, { type: "admin:undo" }, ctx);
    expect(res.events).toContainEqual({ type: "draft:undo", undone: { kind: "award", teamId: "t1", playerId: lot.playerId } });
    expect(res.state.picks.some((p) => p.playerId === lot.playerId)).toBe(false);
    const reopenedLot = res.state.lots.find((l) => l.id === lot.id)!;
    expect(reopenedLot.state).toBe("paused");
    expect(reopenedLot.winnerTeamId).toBeNull();
    expect(reopenedLot.price).toBeNull();
    expect(res.state.lastAwardOrPick).toBeNull();

    // The lot is only live again once the commissioner explicitly resumes.
    const resumed = applyAdminResume(res.state, { type: "admin:resume" }, ctx);
    expect(resumed.state.lots.find((l) => l.id === lot.id)?.state).toBe("open");
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

  it("after undo, the player is eligible for any team to re-nominate, not just the original winner", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    let i = 0;
    state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
    const lot = state.lots[0]!;
    state = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 50 }, ctx).state;
    state = applyLotExpired(state, { type: "clock:lotExpired", lotId: lot.id }, ctx).state;
    state = applyAdminUndo(state, { type: "admin:undo" }, ctx).state;
    state = applyAdminResume(state, { type: "admin:resume" }, ctx).state;

    const reopenedLot = state.lots.find((l) => l.id === lot.id)!;
    expect(reopenedLot.eligibleTeamIds).toContain("t2");
    const res = applyBidSubmit(state, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 20 }, ctx);
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
});
