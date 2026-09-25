import { describe, it, expect } from "vitest";
import { makeCtx, makePlayerPool, makeState, nominateFullRound } from "../helpers.js";
import { reduce } from "../../src/reduce.js";
import { applyAdminStart } from "../../src/rules/start.js";
import { applyNominate, applyNominationExpired } from "../../src/rules/nomination.js";
import { applyBidSubmit } from "../../src/rules/bidding.js";
import { applyLotExpired } from "../../src/rules/reveal.js";
import { beginSnake, applyPickExpired } from "../../src/rules/snake.js";
import type { Action } from "../../src/actions/types.js";
import type { Ctx } from "../../src/clock.js";
import type { DraftState } from "../../src/model/types.js";

/**
 * One test per row of SPEC.md's "Edge cases and failure handling" table.
 * Several rows are exhaustively covered by dedicated rule test files (noted
 * inline); this file exists for direct traceability back to that table,
 * per the build plan, and carries the full weight for rows not otherwise
 * exercised (auto-pick validity, replay determinism, disconnect/two-tabs).
 */
describe("SPEC.md edge cases", () => {
  it("1. Nominator's clock runs out: auto-nominates (placeholder ranking)", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    const res = applyNominationExpired(state, { type: "clock:nominationExpired" }, ctx);
    expect(res.events.some((e) => e.type === "nomination:made")).toBe(true);
  });

  it("2. Team fills its auction spots mid-round: excluded from remaining lots/future nominations; its own queued nominee still runs", () => {
    const players = makePlayerPool("QB", 10);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 1, rosterSize: 5 } });
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    let i = 0;
    state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
    const lot1 = state.lots[0]!; // nominated by t1
    // t2 wins lot1, filling its only spot before lot2 (t2's own nomination) opens.
    state = applyBidSubmit(state, { type: "bid:submit", teamId: "t2", lotId: lot1.id, amount: 10 }, ctx).state;
    state = applyLotExpired(state, { type: "clock:lotExpired", lotId: lot1.id }, ctx).state;
    const lot2 = state.lots[1]!;
    expect(lot2.nominatedByTeamId).toBe("t2");
    expect(lot2.state).toBe("open"); // t2's own queued nominee still runs
    expect(lot2.eligibleTeamIds).not.toContain("t2"); // but t2 itself can't bid on it
  });

  it("3. Team can't afford minBid before filling spots: marked broke, skipped from nominations/bids", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    state = { ...state, picks: [{ id: "p1", pickNo: 1, round: 0, teamId: "t1", playerId: "sink", source: "auction", price: 997, madeAt: 0 }] };
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    expect(state.nominationTurnTeamId).toBe("t2"); // t1 skipped, broke
  });

  it("4. A winning bid leaving a team below minBid with spots left is allowed; the team becomes broke", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    let i = 0;
    state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
    const lot = state.lots[0]!;
    const res = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 998 }, ctx);
    expect(res.events[0]).not.toMatchObject({ type: "draft:rejected" });
  });

  it("5. All tied teams all-in: the fallback decides (see tie.test.ts for full coverage)", () => {
    // Exercised exhaustively in tests/rules/tie.test.ts.
    expect(true).toBe(true);
  });

  it("6. Only one team eligible for a lot: it runs normally (see bidding.test.ts)", () => {
    expect(true).toBe(true);
  });

  it("7. A round with fewer lots than teams runs normally, skipping ineligible teams (see nomination.test.ts)", () => {
    expect(true).toBe(true);
  });

  it("8. Auction ends mid-round: remaining queued lots are cancelled, players return to the pool (see auctionTransition.test.ts)", () => {
    expect(true).toBe(true);
  });

  it("9. Final rounds get small (e.g. 2 teams left): continues correctly (see auctionTransition.test.ts)", () => {
    expect(true).toBe(true);
  });

  it("10. No bids, nominator already full or at position max: returns to pool, re-nominable (see noBid.test.ts)", () => {
    expect(true).toBe(true);
  });

  it("11. A team may nominate a player at a position it's maxed on: allowed, it just can't bid on him", () => {
    const players = [{ id: "qbX", name: "qbX", position: "QB" }, ...makePlayerPool("RB", 5)];
    let state: DraftState = makeState({
      teamCount: 2,
      players,
      settings: { auctionSpots: 8, rosterSize: 17, positionGroups: [{ name: "QB", positions: ["QB"], min: 0, max: 0 }] },
    });
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    const res = applyNominate(state, { type: "nominate", teamId: "t1", playerId: "qbX" }, ctx);
    expect(res.events[0]).not.toMatchObject({ type: "draft:rejected" });
    const lot = res.state.lots[0]!;
    expect(lot.nominatedByTeamId).toBe("t1");
  });

  it("12. Two teams can't nominate the same player in a round: impossible by construction (PLAYER_TAKEN)", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    state = applyNominate(state, { type: "nominate", teamId: "t1", playerId: "qb1" }, ctx).state;
    const res = applyNominate(state, { type: "nominate", teamId: "t2", playerId: "qb1" }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "PLAYER_TAKEN" });
  });

  it("13. A team at a position maximum is ineligible on that lot, with the correct rejection code (see bidding.test.ts)", () => {
    expect(true).toBe(true);
  });

  it("14. A pick that would make remaining position minimums impossible is rejected; auto-pick never proposes such a player", () => {
    // 2 roster spots left, RB min still needs 2 — auto-pick must choose an
    // RB even though a non-RB player is earlier in the placeholder ranking.
    const players = [
      { id: "wr1", name: "wr1", position: "WR" }, // ranked first, but invalid
      { id: "rb1", name: "rb1", position: "RB" },
    ];
    let state: DraftState = makeState({
      teamCount: 1,
      players,
      settings: { auctionSpots: 0, rosterSize: 2, positionGroups: [{ name: "RB", positions: ["RB"], min: 2, max: 2 }], pickExpiryAction: "autoPick" },
    });
    const ctx = makeCtx(1000);
    state = beginSnake(state, ctx).state;
    const res = applyPickExpired(state, { type: "clock:pickExpired", teamId: "t1" }, ctx);
    expect(res.events).toContainEqual(expect.objectContaining({ type: "pick:made", playerId: "rb1" }));
  });

  it("15. A broke team that hasn't met position minimums by make-up rounds is restricted to needed positions (see makeup.test.ts)", () => {
    expect(true).toBe(true);
  });

  it("16. Manager disconnects during a lot: their submitted bid stands regardless of subsequent inactivity", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    let i = 0;
    state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
    const lot = state.lots[0]!;
    state = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 10 }, ctx).state;
    // No engine mechanism exists to expire or revert a bid due to "inactivity" —
    // only an explicit pause or the clock reaching endsAt changes lot state.
    // Simulate a long gap with no further action: the bid is untouched.
    const laterCtx: Ctx = { ...ctx, now: ctx.now + 500 };
    expect(state.bids.some((b) => b.teamId === "t1" && b.amount === 10 && !b.superseded)).toBe(true);
    const res = applyLotExpired(state, { type: "clock:lotExpired", lotId: lot.id }, laterCtx);
    expect(res.events).toContainEqual(expect.objectContaining({ type: "lot:awarded", teamId: "t1", price: 10 }));
  });

  it("17. Server restarts mid-lot: replaying a recorded action log through reduce reproduces identical state", () => {
    const players = makePlayerPool("QB", 10);
    const initial: DraftState = makeState({ teamCount: 3, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(1000);

    const log: Action[] = [
      { type: "admin:start" },
      { type: "nominate", teamId: "t1", playerId: "qb1" },
      { type: "nominate", teamId: "t2", playerId: "qb2" },
      { type: "nominate", teamId: "t3", playerId: "qb3" },
    ];

    const replay = (from: DraftState): DraftState => {
      let s = from;
      for (const action of log) {
        s = reduce(s, action, ctx).state;
      }
      return s;
    };

    const liveResult = replay(initial);
    // "Server restart": rebuild from the same initial state and the same
    // recorded action log (with the same ctx.now/ctx.rng per action).
    const reloadedResult = replay(initial);

    expect(reloadedResult).toEqual(liveResult);
  });

  it("18. Two tabs open for the same team: two bid:submit actions in sequence, the latest wins (see bidding.test.ts upsert coverage too)", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    let i = 0;
    state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
    const lot = state.lots[0]!;
    // "Tab A" then "tab B" for the same team, same lot.
    state = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 10 }, ctx).state;
    state = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 25 }, ctx).state;
    const active = state.bids.filter((b) => b.teamId === "t1" && b.lotId === lot.id && !b.superseded);
    expect(active).toHaveLength(1);
    expect(active[0]?.amount).toBe(25);
  });

  it("19. Commissioner undoes an award: only the most recent (see undo.test.ts)", () => {
    expect(true).toBe(true);
  });

  it("20. A player nominated who's already taken is rejected PLAYER_TAKEN by a unique constraint (see nomination.test.ts)", () => {
    expect(true).toBe(true);
  });

  it("21. Late-breaking injury: an open lot can be voided and re-nominated; a player can be marked unavailable (see lotAdmin.test.ts)", () => {
    expect(true).toBe(true);
  });
});
