import { describe, expect, it } from "vitest";
import { makeCtx, makePlayerPool, makeState, nominateFullRound } from "../helpers.js";
import { applyBidSubmit } from "../../src/rules/bidding.js";
import { applyAdminSetRevealTopN } from "../../src/rules/clockAdmin.js";
import { applyVoidLot } from "../../src/rules/lotAdmin.js";
import { applyNominate } from "../../src/rules/nomination.js";
import { applyLotExpired } from "../../src/rules/reveal.js";
import { applyAdminStart } from "../../src/rules/start.js";
import { applyTieExpired, applyTieRebid } from "../../src/rules/tie.js";
import { revealedBidIds } from "../../src/selectors/secrecy.js";
import type { DraftState } from "../../src/model/types.js";

const ctx = makeCtx(1000);

/** 4 teams, round 1 nominated, lot 1 open. */
function openLot(revealTopN: number | "all" = 2): DraftState {
  const players = makePlayerPool("QB", 10);
  let state = makeState({ teamCount: 4, players, settings: { auctionSpots: 3, rosterSize: 3, positionGroups: null, revealTopN, earlyClose: false } });
  state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
  let i = 0;
  return nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
}

const bid = (state: DraftState, teamId: string, amount: number) => applyBidSubmit(state, { type: "bid:submit", teamId, lotId: state.lots[0]!.id, amount }, ctx).state;
const amountsOf = (state: DraftState) => {
  const ids = revealedBidIds(state);
  return state.bids.filter((b) => ids.has(b.id)).map((b) => `${b.teamId}:${b.tieRound}:${b.amount}`).sort();
};

describe("revealedBidIds (SPEC: hidden losing bids never leave the server)", () => {
  it("reveals nothing while the lot is open", () => {
    let state = openLot();
    state = bid(bid(state, "t1", 50), "t2", 40);
    expect(revealedBidIds(state).size).toBe(0);
  });

  it("after the reveal, only the top N opening bids — the rest stay hidden for good", () => {
    let state = openLot(2);
    for (const [t, a] of [["t1", 50], ["t2", 40], ["t3", 30], ["t4", 20]] as const) state = bid(state, t, a);
    state = applyLotExpired(state, { type: "clock:lotExpired", lotId: state.lots[0]!.id }, ctx).state;
    expect(state.lots[0]!.state).toBe("awarded");
    expect(amountsOf(state)).toEqual(["t1:0:50", "t2:0:40"]);

    // Raising the setting later doesn't retroactively expose older lots.
    state = applyAdminSetRevealTopN(state, { type: "admin:setRevealTopN", revealTopN: "all" }, ctx).state;
    expect(amountsOf(state)).toEqual(["t1:0:50", "t2:0:40"]);
  });

  it("never reveals a changed (superseded) bid", () => {
    let state = openLot("all");
    state = bid(bid(state, "t1", 50), "t1", 60);
    state = applyLotExpired(state, { type: "clock:lotExpired", lotId: state.lots[0]!.id }, ctx).state;
    expect(amountsOf(state)).toEqual(["t1:0:60"]);
  });

  it("a lot voided mid-bidding reveals none of its sealed bids", () => {
    let state = openLot("all");
    state = bid(bid(state, "t1", 50), "t2", 40);
    state = applyVoidLot(state, { type: "admin:voidLot", lotId: state.lots[0]!.id }, ctx).state;
    expect(state.lots[0]!.state).toBe("cancelled");
    expect(revealedBidIds(state).size).toBe(0);
  });

  it("tie re-bids are revealed in full, but only once their round closes", () => {
    let state = openLot(1);
    for (const [t, a] of [["t1", 50], ["t2", 50], ["t3", 30]] as const) state = bid(state, t, a);
    const lotId = state.lots[0]!.id;
    state = applyLotExpired(state, { type: "clock:lotExpired", lotId }, ctx).state;
    expect(state.lots[0]!.state).toBe("tieRebid");
    expect(amountsOf(state)).toEqual(["t1:0:50"]); // winner-only reveal, first of the tied pair in reveal order

    state = applyTieRebid(state, { type: "tie:rebid", teamId: "t1", lotId, amount: 60 }, ctx).state;
    expect(amountsOf(state)).toEqual(["t1:0:50"]); // round 1 still open

    state = applyTieRebid(state, { type: "tie:rebid", teamId: "t2", lotId, amount: 55 }, ctx).state;
    if (state.lots[0]!.state === "tieRebid") state = applyTieExpired(state, { type: "clock:tieExpired", lotId }, ctx).state;
    expect(state.lots[0]!.state).toBe("awarded");
    expect(amountsOf(state)).toEqual(["t1:0:50", "t1:1:60", "t2:1:55"]);
  });
});
