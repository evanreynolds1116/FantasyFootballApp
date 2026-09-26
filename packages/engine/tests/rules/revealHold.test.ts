import { describe, it, expect } from "vitest";
import { makeCtx, makePlayerPool, makeState, nominateFullRound } from "../helpers.js";
import { applyAdminStart } from "../../src/rules/start.js";
import { applyNominate } from "../../src/rules/nomination.js";
import { applyBidSubmit } from "../../src/rules/bidding.js";
import { applyLotExpired } from "../../src/rules/reveal.js";
import { applyTieRebid } from "../../src/rules/tie.js";
import { applyAdminPause } from "../../src/rules/pauseResume.js";
import { REVEAL_HOLD_MS } from "../../src/clock.js";
import type { DraftState } from "../../src/model/types.js";

const BID_SEC = 60;
const NOM_SEC = 45;
const TIE_SEC = 30;

/** Two teams, both lots of round 1 nominated, lot 1 open. */
function openLot() {
  const players = makePlayerPool("QB", 10);
  const ctx = makeCtx(1000);
  let state: DraftState = makeState({
    teamCount: 2,
    players,
    settings: { auctionSpots: 3, rosterSize: 5, positionGroups: null, bidClockSec: BID_SEC, nominationClockSec: NOM_SEC, tieClockSec: TIE_SEC },
  });
  state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
  let i = 0;
  state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
  const [lot1, lot2] = state.lots;
  return { state, lot1: lot1!, lot2: lot2! };
}

describe("the reveal holds the next clock (SPEC: 60 s bid + 10 s reveal)", () => {
  it("the next lot's bid clock starts once the reveal has played", () => {
    const { state: s0, lot1, lot2 } = openLot();
    const s1 = applyBidSubmit(s0, { type: "bid:submit", teamId: "t1", lotId: lot1.id, amount: 20 }, makeCtx(1000)).state;
    const res = applyLotExpired(s1, { type: "clock:lotExpired", lotId: lot1.id }, makeCtx(50_000));
    expect(res.state.revealHoldUntil).toBe(50_000 + REVEAL_HOLD_MS);
    expect(res.state.lots.find((l) => l.id === lot2.id)).toMatchObject({ state: "open", endsAt: 50_000 + REVEAL_HOLD_MS + BID_SEC * 1000 });
    // The award itself is stamped with the real time.
    expect(res.state.picks[0]!.madeAt).toBe(50_000);
  });

  it("the next round's nomination clock waits too, and so does a no-bid lot's", () => {
    const { state: s0, lot1, lot2 } = openLot();
    let s = applyBidSubmit(s0, { type: "bid:submit", teamId: "t1", lotId: lot1.id, amount: 20 }, makeCtx(1000)).state;
    s = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot1.id }, makeCtx(50_000)).state;
    // Lot 2 gets no bids: awarded to its nominator, then round 2's nominations start.
    const res = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot2.id }, makeCtx(200_000));
    expect(res.state.auctionRound).toBe(2);
    expect(res.state.nominationEndsAt).toBe(200_000 + REVEAL_HOLD_MS + NOM_SEC * 1000);
  });

  it("a tie's re-bid clock starts after the reveal, and so does whatever follows the tie's final result", () => {
    const { state: s0, lot1, lot2 } = openLot();
    let s = applyBidSubmit(s0, { type: "bid:submit", teamId: "t1", lotId: lot1.id, amount: 30 }, makeCtx(1000)).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot1.id, amount: 30 }, makeCtx(1000)).state;
    s = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot1.id }, makeCtx(50_000)).state;
    expect(s.lots.find((l) => l.id === lot1.id)).toMatchObject({ state: "tieRebid", endsAt: 50_000 + REVEAL_HOLD_MS + TIE_SEC * 1000 });

    s = applyTieRebid(s, { type: "tie:rebid", teamId: "t1", lotId: lot1.id, amount: 40 }, makeCtx(65_000)).state;
    const res = applyTieRebid(s, { type: "tie:rebid", teamId: "t2", lotId: lot1.id, amount: 35 }, makeCtx(66_000));
    expect(res.state.lots.find((l) => l.id === lot1.id)).toMatchObject({ state: "awarded", winnerTeamId: "t1", price: 40 });
    expect(res.state.revealHoldUntil).toBe(66_000 + REVEAL_HOLD_MS);
    expect(res.state.lots.find((l) => l.id === lot2.id)!.endsAt).toBe(66_000 + REVEAL_HOLD_MS + BID_SEC * 1000);
  });

  it("pausing during the reveal banks the whole next clock", () => {
    const { state: s0, lot1, lot2 } = openLot();
    let s = applyBidSubmit(s0, { type: "bid:submit", teamId: "t1", lotId: lot1.id, amount: 20 }, makeCtx(1000)).state;
    s = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot1.id }, makeCtx(50_000)).state;
    const paused = applyAdminPause(s, { type: "admin:pause" }, makeCtx(54_000)).state;
    expect(paused.lots.find((l) => l.id === lot2.id)!.remainingMs).toBe(BID_SEC * 1000);
    expect(paused.revealHoldUntil).toBeNull();
  });
});
