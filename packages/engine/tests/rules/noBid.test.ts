import { describe, it, expect } from "vitest";
import { makeCtx, makePlayerPool, makeState, nominateFullRound } from "../helpers.js";
import { applyAdminStart } from "../../src/rules/start.js";
import { applyNominate } from "../../src/rules/nomination.js";
import { applyBidSubmit } from "../../src/rules/bidding.js";
import { applyLotExpired } from "../../src/rules/reveal.js";
import type { DraftState } from "../../src/model/types.js";

function openLotFixture(teamCount: number, settings: Record<string, unknown> = {}, extraPicks: DraftState["picks"] = []) {
  const players = makePlayerPool("QB", 30);
  let state: DraftState = makeState({ teamCount, players, settings: { auctionSpots: 8, rosterSize: 17, ...settings } });
  state = { ...state, picks: extraPicks };
  const ctx = makeCtx(1000);
  state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
  let i = 0;
  state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
  const lot = state.lots[0]!;
  return { state, ctx, lot, players };
}

describe("no-bid handling", () => {
  it("no bids, nominator eligible: awarded to the nominator at exactly minBid", () => {
    const { state, ctx, lot } = openLotFixture(2);
    const res = applyLotExpired(state, { type: "clock:lotExpired", lotId: lot.id }, ctx);
    expect(res.events).toContainEqual({
      type: "lot:awarded",
      lotId: lot.id,
      teamId: lot.nominatedByTeamId,
      playerId: lot.playerId,
      price: 5,
    });
  });

  it("no bids, nominator's spots already filled earlier in the same round: returns to pool", () => {
    // t3 nominates last in the round (order t1, t2, t3) and has 7/8 auction
    // spots already filled going in. It wins t1's earlier lot in this same
    // round, filling its 8th and final spot before its own lot opens.
    const players = makePlayerPool("QB", 30);
    const priorPicks = Array.from({ length: 7 }, (_, i) => ({
      id: `pre${i}`,
      pickNo: i + 1,
      round: 0,
      teamId: "t3",
      playerId: `pre${i}`,
      source: "auction" as const,
      price: 5,
      madeAt: 0,
    }));
    let state: DraftState = makeState({ teamCount: 3, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    state = { ...state, picks: priorPicks };
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    let i = 0;
    state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);

    const lot1 = state.lots.find((l) => l.round === 1 && l.orderInRound === 1)!;
    expect(lot1.nominatedByTeamId).toBe("t1");
    // t3 wins lot1, filling its final auction spot.
    state = applyBidSubmit(state, { type: "bid:submit", teamId: "t3", lotId: lot1.id, amount: 50 }, ctx).state;
    state = applyLotExpired(state, { type: "clock:lotExpired", lotId: lot1.id }, ctx).state;
    expect(state.lots.find((l) => l.id === lot1.id)?.winnerTeamId).toBe("t3");

    // lot2 auto-opened and auto-resolves via no-bid to its own nominator (t2); move past it.
    const lot2 = state.lots.find((l) => l.round === 1 && l.orderInRound === 2)!;
    state = applyLotExpired(state, { type: "clock:lotExpired", lotId: lot2.id }, ctx).state;

    const lot3 = state.lots.find((l) => l.round === 1 && l.orderInRound === 3)!;
    expect(lot3.nominatedByTeamId).toBe("t3");
    expect(lot3.eligibleTeamIds).not.toContain("t3");
    const res = applyLotExpired(state, { type: "clock:lotExpired", lotId: lot3.id }, ctx);
    expect(res.events).toContainEqual({ type: "lot:returned", lotId: lot3.id, playerId: lot3.playerId });
    expect(res.state.lots.find((l) => l.id === lot3.id)?.state).toBe("returnedToPool");
  });

  it("no bids, awarding the nominator would break a position max: returns to pool", () => {
    const { state, ctx, lot } = openLotFixture(2, {
      positionGroups: [{ name: "QB", positions: ["QB"], min: 0, max: 0 }],
    });
    const res = applyLotExpired(state, { type: "clock:lotExpired", lotId: lot.id }, ctx);
    expect(res.events).toContainEqual({ type: "lot:returned", lotId: lot.id, playerId: lot.playerId });
  });

  it("noBidAction = returnToPool: always returns to pool even when the nominator is eligible", () => {
    const { state, ctx, lot } = openLotFixture(2, { noBidAction: "returnToPool" });
    const res = applyLotExpired(state, { type: "clock:lotExpired", lotId: lot.id }, ctx);
    expect(res.events).toContainEqual({ type: "lot:returned", lotId: lot.id, playerId: lot.playerId });
  });

  it("a returned player can be re-nominated later by any team", () => {
    const { state, ctx, lot, players } = openLotFixture(2, { noBidAction: "returnToPool" });
    let s = applyLotExpired(state, { type: "clock:lotExpired", lotId: lot.id }, ctx).state;
    // Next round: whichever team is now on the clock re-nominates the returned player.
    const teamId = s.nominationTurnTeamId!;
    const res = applyNominate(s, { type: "nominate", teamId, playerId: lot.playerId }, ctx);
    expect(res.events[0]).not.toMatchObject({ type: "draft:rejected" });
    expect(res.events).toContainEqual(expect.objectContaining({ type: "nomination:made", playerId: lot.playerId }));
    void players;
  });
});
