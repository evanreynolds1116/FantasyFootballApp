import { describe, it, expect } from "vitest";
import { makeCtx, makePlayerPool, makePlayers, makeState, nominateFullRound } from "../helpers.js";
import { applyAdminStart } from "../../src/rules/start.js";
import { applyNominate } from "../../src/rules/nomination.js";
import { applyBidPass, applyBidSubmit } from "../../src/rules/bidding.js";
import { applyLotExpired } from "../../src/rules/reveal.js";
import { applyMarkPlayerAvailable, applyMarkPlayerUnavailable, applyVoidLot } from "../../src/rules/lotAdmin.js";
import { applyAdjustBudget, applyAssignPlayer, applyRemovePick } from "../../src/rules/rosterAdmin.js";
import { applyAdminPause, applyAdminResume, BACK_IN_MS } from "../../src/rules/pauseResume.js";
import { applyAdminUndo } from "../../src/rules/undo.js";
import { beginSnake, applyPickMake } from "../../src/rules/snake.js";
import { reduce } from "../../src/reduce.js";
import type { DraftState } from "../../src/model/types.js";
import { remainingBudget } from "../../src/selectors/budget.js";
import { isPlayerAvailable } from "../../src/selectors/lots.js";
import { openRosterSlots } from "../../src/selectors/slots.js";

const ctx = makeCtx(1000);

/** Two teams, lot 1 open for bidding. */
function openLot(settings = {}) {
  const players = makePlayerPool("QB", 12);
  let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 3, rosterSize: 5, startingBudget: 100, positionGroups: null, ...settings } });
  state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
  let i = 0;
  state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
  return { state, lot: state.lots.find((l) => l.state === "open")! };
}

/** t1 wins lot 1 for $40. */
function afterAward() {
  const { state: s0, lot } = openLot();
  let state = applyBidSubmit(s0, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 40 }, ctx).state;
  state = applyLotExpired(state, { type: "clock:lotExpired", lotId: lot.id }, ctx).state;
  return { state, lot, pick: state.picks[0]! };
}

/** Snake phase straight away: 2 teams, 3 snake rounds, no auction spots. */
function snakeStart() {
  const players = makePlayers([
    ...["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({ id, position: "RB" })),
  ]);
  const state = makeState({ teamCount: 2, players, settings: { auctionSpots: 0, rosterSize: 3, positionGroups: null } });
  return beginSnake({ ...state, phase: "auction" }, ctx).state;
}

describe("commissioner: budget adjustments", () => {
  it("adds and removes money, logs the reason, and counts toward remaining budget", () => {
    const { state } = afterAward();
    const plus = applyAdjustBudget(state, { type: "admin:adjustBudget", teamId: "t1", amount: 25, reason: "Paid league dues late fee back" }, ctx);
    expect(remainingBudget(plus.state, "t1")).toBe(100 - 40 + 25);
    expect(plus.events).toContainEqual({ type: "commish:edit", edit: expect.objectContaining({ kind: "budget", teamId: "t1", amount: 25, reason: "Paid league dues late fee back" }) });
    const minus = applyAdjustBudget(plus.state, { type: "admin:adjustBudget", teamId: "t1", amount: -10, reason: "Fix" }, ctx);
    expect(remainingBudget(minus.state, "t1")).toBe(75);
    expect(minus.state.commishLog).toHaveLength(2);
  });

  it("rejects $0, fractions, a missing reason, and anything that would leave a team below $0", () => {
    const { state } = afterAward();
    const adj = (amount: number, reason = "x") => applyAdjustBudget(state, { type: "admin:adjustBudget", teamId: "t1", amount, reason }, ctx).events[0];
    expect(adj(0)).toMatchObject({ code: "INVALID_EDIT" });
    expect(adj(2.5)).toMatchObject({ code: "INVALID_EDIT" });
    expect(adj(10, "  ")).toMatchObject({ code: "INVALID_EDIT" });
    expect(adj(-61)).toMatchObject({ code: "OVER_BUDGET" });
    expect(adj(-60)).toMatchObject({ type: "commish:edit" });
  });

  it("won't take money from a team that has a bid in on the lot being decided, but can always add", () => {
    const { state: s0, lot } = openLot();
    const state = applyBidSubmit(s0, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 30 }, ctx).state;
    const take = applyAdjustBudget(state, { type: "admin:adjustBudget", teamId: "t1", amount: -5, reason: "x" }, ctx);
    expect(take.events[0]).toMatchObject({ code: "BID_IN_PROGRESS" });
    expect(applyAdjustBudget(state, { type: "admin:adjustBudget", teamId: "t1", amount: 5, reason: "x" }, ctx).events[0]).toMatchObject({ type: "commish:edit" });
    // A pass counts as being in too.
    const passed = applyBidPass(s0, { type: "bid:pass", teamId: "t2", lotId: lot.id }, ctx).state;
    expect(applyAdjustBudget(passed, { type: "admin:adjustBudget", teamId: "t2", amount: -5, reason: "x" }, ctx).events[0]).toMatchObject({ code: "BID_IN_PROGRESS" });
  });

  it("adding money to a broke team makes it eligible for the lot being bid on", () => {
    // t1 spends $96 of $100 on lot 1, so it can't afford the $5 minimum on lot 2.
    const { state: s0, lot } = openLot({ minBid: 5 });
    let state = applyBidSubmit(s0, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 96 }, ctx).state;
    state = applyLotExpired(state, { type: "clock:lotExpired", lotId: lot.id }, ctx).state;
    const next = state.lots.find((l) => l.state === "open")!;
    expect(next.eligibleTeamIds).toEqual(["t2"]);
    const res = applyAdjustBudget(state, { type: "admin:adjustBudget", teamId: "t1", amount: 10, reason: "x" }, ctx);
    expect(res.state.lots.find((l) => l.id === next.id)!.eligibleTeamIds).toEqual(["t1", "t2"]);
  });

  it("works while paused", () => {
    const { state } = afterAward();
    const paused = applyAdminPause(state, { type: "admin:pause" }, ctx).state;
    expect(reduce(paused, { type: "admin:adjustBudget", teamId: "t2", amount: 5, reason: "x" }, ctx).events[0]).toMatchObject({ type: "commish:edit" });
  });
});

describe("commissioner: removing a player from a roster", () => {
  it("refunds an auction price, reopens the spot, returns the player to the pool and logs it", () => {
    const { state, lot, pick } = afterAward();
    const res = applyRemovePick(state, { type: "admin:removePick", pickId: pick.id }, ctx);
    expect(res.state.picks).toHaveLength(0);
    expect(remainingBudget(res.state, "t1")).toBe(100);
    expect(openRosterSlots(res.state, "t1").auction).toBe(3);
    expect(isPlayerAvailable(res.state, lot.playerId)).toBe(true);
    expect(res.state.lots.find((l) => l.id === lot.id)!.state).toBe("returnedToPool");
    expect(res.events).toContainEqual({ type: "commish:edit", edit: expect.objectContaining({ kind: "remove", teamId: "t1", playerId: lot.playerId, price: 40, source: "auction" }) });
  });

  it("clears the undo target when it removes the last award", () => {
    const { state, pick } = afterAward();
    const res = applyRemovePick(state, { type: "admin:removePick", pickId: pick.id }, ctx);
    expect(res.state.lastAwardOrPick).toBeNull();
    expect(applyAdminUndo(res.state, { type: "admin:undo" }, ctx).events[0]).toMatchObject({ code: "NOTHING_TO_UNDO" });
  });

  it("rejects an unknown pick and any roster edit during the make-up round", () => {
    const { state, pick } = afterAward();
    expect(applyRemovePick(state, { type: "admin:removePick", pickId: "nope" }, ctx).events[0]).toMatchObject({ code: "INVALID_EDIT" });
    const makeup = { ...state, phase: "makeup" as const };
    expect(applyRemovePick(makeup, { type: "admin:removePick", pickId: pick.id }, ctx).events[0]).toMatchObject({ code: "INVALID_PHASE" });
    expect(applyAssignPlayer(makeup, { type: "admin:assignPlayer", teamId: "t2", playerId: "qb12", slot: "auction", price: 5 }, ctx).events[0]).toMatchObject({ code: "INVALID_PHASE" });
  });

  it("removing a past snake pick opens a snake spot that no turn will fill", () => {
    let state = snakeStart();
    expect(openRosterSlots(state, "t1").snake).toBe(0);
    state = applyPickMake(state, { type: "pick:make", teamId: "t1", playerId: "a" }, ctx).state;
    expect(openRosterSlots(state, "t1").snake).toBe(0);
    const removed = applyRemovePick(state, { type: "admin:removePick", pickId: state.picks[0]!.id }, ctx).state;
    expect(openRosterSlots(removed, "t1").snake).toBe(1);
    // Team 2 is still on the clock; the snake carries on unchanged.
    expect(removed.snakePickTurnTeamId).toBe("t2");
  });
});

describe("commissioner: adding a player to a roster", () => {
  it("puts an available player in an open auction spot at a price, without becoming the undo target", () => {
    const { state } = afterAward();
    const res = applyAssignPlayer(state, { type: "admin:assignPlayer", teamId: "t2", playerId: "qb12", slot: "auction", price: 15 }, ctx);
    const added = res.state.picks.find((p) => p.playerId === "qb12")!;
    expect(added).toMatchObject({ teamId: "t2", source: "auction", price: 15 });
    expect(remainingBudget(res.state, "t2")).toBe(85);
    expect(isPlayerAvailable(res.state, "qb12")).toBe(false);
    expect(res.state.lastAwardOrPick).toEqual(state.lastAwardOrPick);
    expect(res.events).toContainEqual({ type: "commish:edit", edit: expect.objectContaining({ kind: "assign", teamId: "t2", playerId: "qb12", slot: "auction", price: 15 }) });
  });

  it("gives every pick a unique number, even after one in the middle is removed", () => {
    const { state, pick } = afterAward();
    let s = applyAssignPlayer(state, { type: "admin:assignPlayer", teamId: "t2", playerId: "qb12", slot: "auction", price: 1 }, ctx).state;
    s = applyRemovePick(s, { type: "admin:removePick", pickId: pick.id }, ctx).state;
    s = applyAssignPlayer(s, { type: "admin:assignPlayer", teamId: "t2", playerId: "qb11", slot: "auction", price: 1 }, ctx).state;
    const numbers = s.picks.map((p) => p.pickNo);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("rejects a taken or unavailable player, no open spot, a missing price, or a price over budget", () => {
    const { state, lot } = afterAward();
    const assign = (s: DraftState, playerId: string, price?: number, teamId = "t2") =>
      applyAssignPlayer(s, { type: "admin:assignPlayer", teamId, playerId, slot: "auction", price }, ctx).events[0];
    expect(assign(state, lot.playerId, 5)).toMatchObject({ code: "PLAYER_TAKEN" });
    const unavailable = applyMarkPlayerUnavailable(state, { type: "admin:markPlayerUnavailable", playerId: "qb12" }, ctx).state;
    expect(assign(unavailable, "qb12", 5)).toMatchObject({ code: "PLAYER_TAKEN" });
    expect(assign(state, "qb12")).toMatchObject({ code: "INVALID_EDIT" });
    expect(assign(state, "qb12", 101)).toMatchObject({ code: "OVER_BUDGET" });
    // No snake spot is open during the auction: the snake rounds will fill them.
    expect(applyAssignPlayer(state, { type: "admin:assignPlayer", teamId: "t2", playerId: "qb12", slot: "snake" }, ctx).events[0]).toMatchObject({ code: "ROSTER_FULL" });
  });

  it("respects position maximums", () => {
    const { state } = afterAward();
    const limited = { ...state, settings: { ...state.settings, positionGroups: [{ name: "QB", positions: ["QB"], min: 0, max: 1 }] } };
    expect(applyAssignPlayer(limited, { type: "admin:assignPlayer", teamId: "t1", playerId: "qb12", slot: "auction", price: 1 }, ctx).events[0]).toMatchObject({
      code: "POSITION_LIMIT",
    });
  });

  it("won't add a paid player to a team with a bid in on the lot being decided", () => {
    const { state: s0, lot } = openLot();
    const state = applyBidSubmit(s0, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 30 }, ctx).state;
    expect(applyAssignPlayer(state, { type: "admin:assignPlayer", teamId: "t1", playerId: "qb12", slot: "auction", price: 1 }, ctx).events[0]).toMatchObject({
      code: "BID_IN_PROGRESS",
    });
  });

  it("fills a snake spot opened by a removal, after which none are open", () => {
    let state = snakeStart();
    state = applyPickMake(state, { type: "pick:make", teamId: "t1", playerId: "a" }, ctx).state;
    state = applyRemovePick(state, { type: "admin:removePick", pickId: state.picks[0]!.id }, ctx).state;
    const res = applyAssignPlayer(state, { type: "admin:assignPlayer", teamId: "t1", playerId: "b", slot: "snake" }, ctx);
    expect(res.state.picks.find((p) => p.playerId === "b")).toMatchObject({ teamId: "t1", source: "snake", price: null });
    expect(openRosterSlots(res.state, "t1").snake).toBe(0);
  });
});

describe("commissioner: void lot and player availability", () => {
  it("voids a lot in a tie re-bid; nobody gets the player and it's logged", () => {
    const { state: s0, lot } = openLot();
    let state = applyBidSubmit(s0, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 30 }, ctx).state;
    state = applyBidSubmit(state, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 30 }, ctx).state;
    state = applyLotExpired(state, { type: "clock:lotExpired", lotId: lot.id }, ctx).state;
    expect(state.lots.find((l) => l.id === lot.id)!.state).toBe("tieRebid");
    const res = applyVoidLot(state, { type: "admin:voidLot", lotId: lot.id }, ctx);
    expect(res.state.lots.find((l) => l.id === lot.id)!.state).toBe("cancelled");
    expect(res.state.picks).toHaveLength(0);
    expect(isPlayerAvailable(res.state, lot.playerId)).toBe(true);
    expect(res.events).toContainEqual({ type: "commish:edit", edit: expect.objectContaining({ kind: "void", lotId: lot.id, playerId: lot.playerId }) });
  });

  it("marks a player available again, and logs both changes", () => {
    const { state } = openLot();
    const out = applyMarkPlayerUnavailable(state, { type: "admin:markPlayerUnavailable", playerId: "qb12" }, ctx);
    expect(isPlayerAvailable(out.state, "qb12")).toBe(false);
    expect(applyMarkPlayerUnavailable(out.state, { type: "admin:markPlayerUnavailable", playerId: "qb12" }, ctx).events[0]).toMatchObject({ code: "INVALID_EDIT" });
    const back = applyMarkPlayerAvailable(out.state, { type: "admin:markPlayerAvailable", playerId: "qb12" }, ctx);
    expect(isPlayerAvailable(back.state, "qb12")).toBe(true);
    expect(back.state.commishLog.map((e) => e.kind)).toEqual(["unavailable", "available"]);
  });

  it("rejects marking available a player who isn't unavailable", () => {
    const { state } = openLot();
    expect(applyMarkPlayerAvailable(state, { type: "admin:markPlayerAvailable", playerId: "qb12" }, ctx).events[0]).toMatchObject({ code: "INVALID_EDIT" });
  });
});

describe("resume: the 10-second back-in countdown", () => {
  it("holds every resume for 10 s before the clock picks up again", () => {
    const { state: s0, lot } = openLot();
    const paused = applyAdminPause(s0, { type: "admin:pause" }, makeCtx(lot.endsAt! - 30_000)).state;
    const res = applyAdminResume(paused, { type: "admin:resume" }, makeCtx(500_000));
    expect(res.state.resumeHoldUntil).toBe(500_000 + BACK_IN_MS);
    expect(res.state.lots.find((l) => l.id === lot.id)!.endsAt).toBe(500_000 + BACK_IN_MS + 30_000);
  });

  it("pausing again during the countdown banks only the real clock time", () => {
    const { state: s0, lot } = openLot();
    const paused = applyAdminPause(s0, { type: "admin:pause" }, makeCtx(lot.endsAt! - 30_000)).state;
    const resumed = applyAdminResume(paused, { type: "admin:resume" }, makeCtx(500_000)).state;
    const again = applyAdminPause(resumed, { type: "admin:pause" }, makeCtx(504_000)).state;
    expect(again.lots.find((l) => l.id === lot.id)!.remainingMs).toBe(30_000);
    expect(again.resumeHoldUntil).toBeNull();
  });
});
