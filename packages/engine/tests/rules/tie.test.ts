import { describe, it, expect } from "vitest";
import { makeCtx, makePlayerPool, makeState, nominateFullRound } from "../helpers.js";
import { applyAdminStart } from "../../src/rules/start.js";
import { applyNominate } from "../../src/rules/nomination.js";
import { applyBidSubmit } from "../../src/rules/bidding.js";
import { applyLotExpired } from "../../src/rules/reveal.js";
import { applyResolveTie, applyTieExpired, applyTieRebid } from "../../src/rules/tie.js";
import type { DraftState } from "../../src/model/types.js";

function openLotFixture(teamCount: number, settings: Record<string, unknown> = {}) {
  const players = makePlayerPool("QB", 30);
  let state: DraftState = makeState({ teamCount, players, settings: { auctionSpots: 8, rosterSize: 17, ...settings } });
  const ctx = makeCtx(1000);
  state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
  let i = 0;
  state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
  const lot = state.lots[0]!;
  return { state, ctx, lot, players };
}

describe("tie re-bid loop", () => {
  it("two teams tie: lot:tie lists exactly those teams with minBidPerTeam = prevBid + tieMinRaise", () => {
    const { state, ctx, lot } = openLotFixture(3, { tieMinRaise: 5 });
    let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t3", lotId: lot.id, amount: 20 }, ctx).state;
    const res = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot.id }, ctx);

    const tieEvent = res.events.find((e) => e.type === "lot:tie");
    expect(tieEvent).toMatchObject({
      type: "lot:tie",
      tiedTeamIds: ["t1", "t2"],
      minBidPerTeam: { t1: 55, t2: 55 },
      tieRound: 1,
    });
    expect(res.state.lots.find((l) => l.id === lot.id)?.state).toBe("tieRebid");
  });

  it("three-way tie, one can't/won't raise: only the still-tied subset continues (matches the $250/$250/$220 example)", () => {
    const { state, ctx, lot } = openLotFixture(4, { tieMinRaise: 5 });
    let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 250 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 250 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t3", lotId: lot.id, amount: 250 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t4", lotId: lot.id, amount: 100 }, ctx).state;
    s = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot.id }, ctx).state;
    expect(s.lots.find((l) => l.id === lot.id)?.tiedTeamIds.sort()).toEqual(["t1", "t2", "t3"]);

    s = applyTieRebid(s, { type: "tie:rebid", teamId: "t1", lotId: lot.id, amount: 260 }, ctx).state;
    s = applyTieRebid(s, { type: "tie:rebid", teamId: "t2", lotId: lot.id, amount: 260 }, ctx).state;
    const res = applyTieRebid(s, { type: "tie:rebid", teamId: "t3", lotId: lot.id, amount: 255 }, ctx);

    const revealed = res.events.find((e) => e.type === "lot:tieRebidRevealed");
    expect(revealed).toMatchObject({
      bids: [
        { teamId: "t1", amount: 260 },
        { teamId: "t2", amount: 260 },
        { teamId: "t3", amount: 255 },
      ],
    });
    // t3's 255 < 260, so only t1/t2 continue into round 2.
    const nextTie = res.events.find((e) => e.type === "lot:tie");
    expect(nextTie).toMatchObject({ tiedTeamIds: ["t1", "t2"], tieRound: 2 });
  });

  it("rebid below own-previous + tieMinRaise is rejected BID_TOO_LOW", () => {
    const { state, ctx, lot } = openLotFixture(3, { tieMinRaise: 5 });
    let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot.id }, ctx).state;
    const res = applyTieRebid(s, { type: "tie:rebid", teamId: "t1", lotId: lot.id, amount: 54 }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "BID_TOO_LOW" });
  });

  it("rebid exceeding remaining budget is rejected OVER_BUDGET", () => {
    const { state, ctx, lot } = openLotFixture(3, { tieMinRaise: 5 });
    let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot.id }, ctx).state;
    const res = applyTieRebid(s, { type: "tie:rebid", teamId: "t1", lotId: lot.id, amount: 5000 }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "OVER_BUDGET" });
  });

  it("a tie resolves after 2+ rebid rounds; final price equals the winner's last rebid", () => {
    const { state, ctx, lot } = openLotFixture(3, { tieMinRaise: 5 });
    let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot.id }, ctx).state;
    expect(s.lots.find((l) => l.id === lot.id)?.tieRound).toBe(1);

    // Round 1: still tied at 60.
    s = applyTieRebid(s, { type: "tie:rebid", teamId: "t1", lotId: lot.id, amount: 60 }, ctx).state;
    s = applyTieRebid(s, { type: "tie:rebid", teamId: "t2", lotId: lot.id, amount: 60 }, ctx).state;
    expect(s.lots.find((l) => l.id === lot.id)?.tieRound).toBe(2);

    // Round 2: t1 breaks the tie.
    s = applyTieRebid(s, { type: "tie:rebid", teamId: "t1", lotId: lot.id, amount: 70 }, ctx).state;
    const res = applyTieRebid(s, { type: "tie:rebid", teamId: "t2", lotId: lot.id, amount: 65 }, ctx);

    expect(res.events).toContainEqual({ type: "lot:awarded", lotId: lot.id, teamId: "t1", playerId: lot.playerId, price: 70 });
  });

  it("a tied team that doesn't rebid in time keeps its previous bid when the clock expires", () => {
    const { state, ctx, lot } = openLotFixture(3, { tieMinRaise: 5 });
    let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot.id }, ctx).state;
    // Only t1 rebids; t2's previous bid (50) stands when the clock expires.
    s = applyTieRebid(s, { type: "tie:rebid", teamId: "t1", lotId: lot.id, amount: 60 }, ctx).state;
    const res = applyTieExpired(s, { type: "clock:tieExpired", lotId: lot.id }, ctx);
    expect(res.events).toContainEqual({ type: "lot:awarded", lotId: lot.id, teamId: "t1", playerId: lot.playerId, price: 60 });
  });

  it("maxTieRounds reached triggers fallback even if teams could still raise", () => {
    const { state, ctx, lot } = openLotFixture(3, { tieMinRaise: 5, maxTieRounds: 1, tieFallback: "earlierTeamNumber" });
    let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot.id }, ctx).state;
    // Round 1: both raise and remain tied — but maxTieRounds=1 means round 2 can't open.
    const res = applyTieRebid(
      applyTieRebid(s, { type: "tie:rebid", teamId: "t1", lotId: lot.id, amount: 60 }, ctx).state,
      { type: "tie:rebid", teamId: "t2", lotId: lot.id, amount: 60 },
      ctx,
    );
    expect(res.events).toContainEqual({ type: "lot:fallback", lotId: lot.id, method: "earlierTeamNumber", winnerTeamId: "t1" });
    expect(res.events).toContainEqual({ type: "lot:awarded", lotId: lot.id, teamId: "t1", playerId: lot.playerId, price: 60 });
  });

  it("all tied teams all-in triggers fallback immediately", () => {
    const { state, ctx, lot } = openLotFixture(3, { tieMinRaise: 5, startingBudget: 60, tieFallback: "randomDraw" });
    let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 60 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 60 }, ctx).state;
    // Both teams have $0 left after a $60 bid on a $60 budget — neither can raise by $5.
    const res = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot.id }, ctx);
    expect(res.events).toContainEqual(expect.objectContaining({ type: "lot:fallback", method: "randomDraw" }));
    expect(res.events).toContainEqual(expect.objectContaining({ type: "lot:awarded", price: 60 }));
  });

  it("tieFallback = higherBudget: the tied team with more remaining budget wins", () => {
    // maxTieRounds: 0 forces the fallback to resolve right after the initial
    // tie, isolating the fallback-method logic from the rebid-round mechanics
    // already covered by the tests above.
    const { state, ctx, lot } = openLotFixture(3, { tieMinRaise: 5, tieFallback: "higherBudget", maxTieRounds: 0 });
    // t1 spends more elsewhere first so it has less budget left than t2.
    let s: DraftState = { ...state, picks: [{ id: "pre", pickNo: 1, round: 0, teamId: "t1", playerId: "pre", source: "auction", price: 400, madeAt: 0 }] };
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 50 }, ctx).state;
    const res = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot.id }, ctx);
    expect(res.events).toContainEqual({ type: "lot:fallback", lotId: lot.id, method: "higherBudget", winnerTeamId: "t2" });
  });

  it("tieFallback = commissionerDecides: waits for admin:resolveTie, rejects a non-tied team", () => {
    const { state, ctx, lot } = openLotFixture(3, { tieMinRaise: 5, tieFallback: "commissionerDecides", maxTieRounds: 0 });
    let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot.id }, ctx).state;
    expect(s.lots.find((l) => l.id === lot.id)?.state).toBe("fallback");

    const badRes = applyResolveTie(s, { type: "admin:resolveTie", lotId: lot.id, teamId: "t3" }, ctx);
    expect(badRes.events[0]).toMatchObject({ type: "draft:rejected", code: "NOT_TIE_FALLBACK" });

    const res = applyResolveTie(s, { type: "admin:resolveTie", lotId: lot.id, teamId: "t2" }, ctx);
    expect(res.events).toContainEqual({ type: "lot:fallback", lotId: lot.id, method: "commissionerDecides", winnerTeamId: "t2" });
    expect(res.events).toContainEqual({ type: "lot:awarded", lotId: lot.id, teamId: "t2", playerId: lot.playerId, price: 50 });
  });

  it("winning price after a tie always equals the final rebid amount, never the original tied amount", () => {
    const { state, ctx, lot } = openLotFixture(3, { tieMinRaise: 5 });
    let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot.id }, ctx).state;
    const res = applyTieRebid(
      applyTieRebid(s, { type: "tie:rebid", teamId: "t1", lotId: lot.id, amount: 80 }, ctx).state,
      { type: "tie:rebid", teamId: "t2", lotId: lot.id, amount: 65 },
      ctx,
    );
    const awarded = res.events.find((e) => e.type === "lot:awarded") as { price: number };
    expect(awarded.price).toBe(80);
    expect(awarded.price).not.toBe(50);
  });

  it("maxTieRounds = null (unlimited): a 5-round rebid stress case never falls back prematurely", () => {
    const { state, ctx, lot } = openLotFixture(3, { tieMinRaise: 5, maxTieRounds: null, startingBudget: 100000 });
    let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot.id }, ctx).state;
    let amount = 50;
    for (let round = 1; round <= 5; round += 1) {
      amount += 5;
      s = applyTieRebid(s, { type: "tie:rebid", teamId: "t1", lotId: lot.id, amount }, ctx).state;
      const res = applyTieRebid(s, { type: "tie:rebid", teamId: "t2", lotId: lot.id, amount }, ctx);
      s = res.state;
      expect(res.events).not.toContainEqual(expect.objectContaining({ type: "lot:fallback" }));
    }
    expect(s.lots.find((l) => l.id === lot.id)?.tieRound).toBe(6);
  });

  it("tie clock off: the round only closes once all currently-tied teams have submitted, regardless of earlyClose", () => {
    const { state, ctx, lot } = openLotFixture(3, { tieMinRaise: 5, tieClockSec: "off", earlyClose: false });
    let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot.id }, ctx).state;
    expect(s.lots.find((l) => l.id === lot.id)?.endsAt).toBeNull();
    s = applyTieRebid(s, { type: "tie:rebid", teamId: "t1", lotId: lot.id, amount: 60 }, ctx).state;
    // Still open, waiting on t2.
    expect(s.lots.find((l) => l.id === lot.id)?.state).toBe("tieRebid");
    const res = applyTieRebid(s, { type: "tie:rebid", teamId: "t2", lotId: lot.id, amount: 65 }, ctx);
    expect(res.events).toContainEqual({ type: "lot:awarded", lotId: lot.id, teamId: "t2", playerId: lot.playerId, price: 65 });
  });
});
