import { describe, expect, it } from "vitest";
import { makeCtx, makePlayerPool, makeState, nominateFullRound } from "../helpers.js";
import { reduce } from "../../src/reduce.js";
import { applyAdminPause } from "../../src/rules/pauseResume.js";
import { applyBidPass, applyBidSubmit } from "../../src/rules/bidding.js";
import { applyNominate } from "../../src/rules/nomination.js";
import { applyLotExpired } from "../../src/rules/reveal.js";
import { applyAdminStart } from "../../src/rules/start.js";
import { revealedBidIds } from "../../src/selectors/secrecy.js";
import type { DraftState } from "../../src/model/types.js";

const ctx = makeCtx(1000);

/** 3 teams, round 1 nominated (t1 nominated lot 1), lot 1 open. */
function openLot(settings: Record<string, unknown> = {}): DraftState {
  const players = makePlayerPool("QB", 10);
  let state = makeState({ teamCount: 3, players, settings: { auctionSpots: 3, rosterSize: 3, positionGroups: null, ...settings } });
  state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
  let i = 0;
  return nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
}
const lotOf = (s: DraftState) => s.lots[0]!;
const pass = (s: DraftState, teamId: string) => applyBidPass(s, { type: "bid:pass", teamId, lotId: lotOf(s).id }, ctx);
const bid = (s: DraftState, teamId: string, amount: number) => applyBidSubmit(s, { type: "bid:submit", teamId, lotId: lotOf(s).id, amount }, ctx);
const expire = (s: DraftState) => applyLotExpired(s, { type: "clock:lotExpired", lotId: lotOf(s).id }, ctx);

describe("pass (opening sealed round)", () => {
  it("broadcasts exactly like a bid, so nobody can tell before the reveal", () => {
    const res = pass(openLot(), "t2");
    expect(res.events).toEqual([{ type: "lot:bidStatus", lotId: lotOf(res.state).id, teamId: "t2", hasBid: true }]);
  });

  it("counts as in for early close", () => {
    let state = bid(openLot(), "t1", 20).state;
    state = pass(state, "t2").state;
    const res = pass(state, "t3");
    expect(res.events.map((e) => e.type)).toEqual(["lot:bidStatus", "lot:closing"]);
  });

  it("is never a bid when the lot is decided, and the reveal counts passes", () => {
    let state = bid(openLot(), "t1", 20).state;
    state = pass(pass(state, "t2").state, "t3").state;
    const res = expire(state);
    expect(res.events.find((e) => e.type === "lot:reveal")).toMatchObject({ bids: [{ teamId: "t1", amount: 20 }], winnerTeamId: "t1", passes: 2 });
    expect(res.state.lots[0]).toMatchObject({ state: "awarded", winnerTeamId: "t1", price: 20 });
    // A pass never shows up as a revealed amount.
    const passIds = res.state.bids.filter((b) => b.pass).map((b) => b.id);
    expect(passIds.some((id) => revealedBidIds(res.state).has(id))).toBe(false);
  });

  it("can be changed to a bid, and a bid can be changed to a pass, until the clock ends", () => {
    let state = pass(openLot(), "t2").state;
    state = bid(state, "t2", 30).state; // pass -> bid
    state = bid(state, "t3", 25).state;
    state = pass(state, "t3").state; // bid -> pass
    const res = expire(state);
    expect(res.events.find((e) => e.type === "lot:reveal")).toMatchObject({ bids: [{ teamId: "t2", amount: 30 }], passes: 1 });
    expect(res.state.lots[0]).toMatchObject({ winnerTeamId: "t2", price: 30 });
  });

  it("if everyone passes — nominator included — the normal no-bid rule applies", () => {
    let state = openLot({ noBidAction: "awardNominator", minBid: 5 });
    for (const t of ["t1", "t2", "t3"]) state = pass(state, t).state;
    const res = expire(state);
    expect(res.events.find((e) => e.type === "lot:reveal")).toMatchObject({ bids: [], winnerTeamId: null, passes: 3 });
    expect(res.state.lots[0]).toMatchObject({ state: "awarded", winnerTeamId: lotOf(state).nominatedByTeamId, price: 5 });

    let returnState = openLot({ noBidAction: "returnToPool" });
    for (const t of ["t1", "t2", "t3"]) returnState = pass(returnState, t).state;
    expect(expire(returnState).state.lots[0]!.state).toBe("returnedToPool");
  });

  it("is refused when the lot isn't open, the team isn't eligible, or the draft is paused", () => {
    const state = openLot();
    expect(applyBidPass(state, { type: "bid:pass", teamId: "t9", lotId: lotOf(state).id }, ctx).events[0]).toMatchObject({ code: "NOT_ELIGIBLE" });
    expect(applyBidPass(state, { type: "bid:pass", teamId: "t1", lotId: "nope" }, ctx).events[0]).toMatchObject({ code: "LOT_CLOSED" });
    const paused = applyAdminPause(state, { type: "admin:pause" }, ctx).state;
    expect(reduce(paused, { type: "bid:pass", teamId: "t1", lotId: lotOf(state).id }, ctx).events[0]).toMatchObject({ code: "DRAFT_PAUSED" });
  });

  it("isn't available in tie re-bid rounds (opening round only)", () => {
    let state = bid(bid(openLot(), "t1", 40).state, "t2", 40).state;
    state = pass(state, "t3").state;
    state = expire(state).state;
    expect(lotOf(state).state).toBe("tieRebid");
    expect(pass(state, "t1").events[0]).toMatchObject({ type: "draft:rejected", code: "LOT_CLOSED" });
  });
});
