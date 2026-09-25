import { describe, it, expect } from "vitest";
import { makeCtx, makePlayerPool, makeState, nominateFullRound } from "../helpers.js";
import { applyAdminStart } from "../../src/rules/start.js";
import { applyNominate } from "../../src/rules/nomination.js";
import { applyBidSubmit } from "../../src/rules/bidding.js";
import type { DraftState } from "../../src/model/types.js";

function openLotFixture(teamCount = 2, extraSettings: Record<string, unknown> = {}) {
  const players = makePlayerPool("QB", 20);
  let state = makeState({ teamCount, players, settings: { auctionSpots: 8, rosterSize: 17, ...extraSettings } });
  const ctx = makeCtx(1000);
  state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
  let i = 0;
  state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
  const lot = state.lots[0]!;
  return { state, ctx, lot, players };
}

describe("bidding", () => {
  it("accepts a valid sealed bid, emits hasBid without an amount", () => {
    const { state, ctx, lot } = openLotFixture();
    const res = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 10 }, ctx);
    expect(res.events).toContainEqual({ type: "lot:bidStatus", lotId: lot.id, teamId: "t1", hasBid: true });
    for (const e of res.events) {
      expect(Object.keys(e)).not.toContain("amount");
    }
    expect(res.state.bids.some((b) => b.teamId === "t1" && b.amount === 10 && !b.superseded)).toBe(true);
  });

  it("upserts: a second bid from the same team supersedes the first", () => {
    const { state, ctx, lot } = openLotFixture();
    let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 10 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 20 }, ctx).state;
    const active = s.bids.filter((b) => b.teamId === "t1" && b.lotId === lot.id && !b.superseded);
    expect(active).toHaveLength(1);
    expect(active[0]?.amount).toBe(20);
    expect(s.bids.filter((b) => b.teamId === "t1" && b.lotId === lot.id)).toHaveLength(2);
  });

  it("rejects a bid below minBid", () => {
    const { state, ctx, lot } = openLotFixture();
    const res = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 1 }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "BID_TOO_LOW" });
    expect(res.state).toBe(state);
  });

  it("rejects a bid that isn't a multiple of the bid step", () => {
    const { state, ctx, lot } = openLotFixture(2, { bidStep: 5 });
    const res = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 47 }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "BID_TOO_LOW" });
  });

  it("rejects a bid exceeding remaining budget", () => {
    const { state, ctx, lot } = openLotFixture();
    const res = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 5000 }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "OVER_BUDGET" });
  });

  it("rejects a bid from a team not eligible for this lot", () => {
    // t1 is already at the QB max (0..1) *before* the lot opens, so its eligibility snapshot excludes it.
    const players = makePlayerPool("QB", 20);
    let state: DraftState = makeState({
      teamCount: 2,
      players: [...players, { id: "sink", name: "sink", position: "QB" }],
      settings: { auctionSpots: 8, rosterSize: 17, positionGroups: [{ name: "QB", positions: ["QB"], min: 0, max: 1 }] },
    });
    state = {
      ...state,
      picks: [{ id: "p0", pickNo: 1, round: 0, teamId: "t1", playerId: "sink", source: "auction", price: 5, madeAt: 0 }],
    };
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    let i = 0;
    state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
    const lot = state.lots[0]!;
    expect(lot.eligibleTeamIds).toEqual(["t2"]);
    const res = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 10 }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "NOT_ELIGIBLE" });
  });

  it("rejects a bid after the lot's endsAt even if lot.state is still open", () => {
    const { state, ctx, lot } = openLotFixture();
    const lateCtx = { ...ctx, now: (lot.endsAt ?? 0) + 1 };
    const res = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 10 }, lateCtx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "LOT_CLOSED" });
  });

  it("only one team eligible for a lot: solo team can bid and the lot runs normally", () => {
    const { state, ctx, lot } = openLotFixture(1);
    expect(lot.eligibleTeamIds).toEqual(["t1"]);
    const res = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 10 }, ctx);
    expect(res.events[0]).toMatchObject({ type: "lot:bidStatus", hasBid: true });
  });

  describe("early close", () => {
    it("emits lot:closing with a 3s last-chance window once every eligible team has bid", () => {
      const { state, ctx, lot } = openLotFixture(2, { earlyClose: true });
      let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 10 }, ctx).state;
      const res = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 20 }, ctx);
      expect(res.events).toContainEqual({ type: "lot:closing", lotId: lot.id, endsAt: ctx.now + 3000 });
      const updatedLot = res.state.lots.find((l) => l.id === lot.id)!;
      expect(updatedLot.endsAt).toBe(ctx.now + 3000);
    });

    it("a bid change during the 3s last-chance window still succeeds and does not re-trigger closing", () => {
      const { state, ctx, lot } = openLotFixture(2, { earlyClose: true });
      let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 10 }, ctx).state;
      s = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 20 }, ctx).state;
      const withinWindow = { ...ctx, now: ctx.now + 1000 };
      const res = applyBidSubmit(s, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 15 }, withinWindow);
      expect(res.events).not.toContainEqual(expect.objectContaining({ type: "lot:closing" }));
      expect(res.state.bids.some((b) => b.teamId === "t1" && b.amount === 15 && !b.superseded)).toBe(true);
    });

    it("without early close, the lot stays open after everyone bids until the clock expires", () => {
      const { state, ctx, lot } = openLotFixture(2, { earlyClose: false });
      let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 10 }, ctx).state;
      const res = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 20 }, ctx);
      expect(res.events).not.toContainEqual(expect.objectContaining({ type: "lot:closing" }));
      const updatedLot = res.state.lots.find((l) => l.id === lot.id)!;
      expect(updatedLot.state).toBe("open");
      expect(updatedLot.endsAt).toBe(lot.endsAt);
    });
  });
});
