import { describe, it, expect } from "vitest";
import { makeCtx, makePlayerPool, makeState, nominateFullRound } from "../helpers.js";
import { applyAdminStart } from "../../src/rules/start.js";
import { applyNominate } from "../../src/rules/nomination.js";
import { applyBidSubmit } from "../../src/rules/bidding.js";
import { applyLotExpired } from "../../src/rules/reveal.js";
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

describe("reveal", () => {
  it("single high bidder: reveal shows winner + runner-ups, award is atomic", () => {
    const { state, ctx, lot } = openLotFixture(3, { revealTopN: 3 });
    let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 30 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t3", lotId: lot.id, amount: 40 }, ctx).state;
    const res = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot.id }, ctx);

    const reveal = res.events.find((e) => e.type === "lot:reveal");
    expect(reveal).toMatchObject({
      type: "lot:reveal",
      winnerTeamId: "t1",
      bids: [
        { teamId: "t1", amount: 50 },
        { teamId: "t3", amount: 40 },
        { teamId: "t2", amount: 30 },
      ],
    });
    expect(res.events).toContainEqual({ type: "lot:awarded", lotId: lot.id, teamId: "t1", playerId: lot.playerId, price: 50 });
    expect(res.events).toContainEqual(expect.objectContaining({ type: "pick:made", teamId: "t1", source: "auction" }));

    // Atomic: budget, roster, and drafted-flag all reflect the award together.
    const picks = res.state.picks.filter((p) => p.teamId === "t1");
    expect(picks).toHaveLength(1);
    expect(picks[0]?.price).toBe(50);
    expect(res.state.lots.find((l) => l.id === lot.id)?.state).toBe("awarded");
  });

  it("revealTopN = 1 shows only the winner", () => {
    const { state, ctx, lot } = openLotFixture(3, { revealTopN: 1 });
    let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 30 }, ctx).state;
    const res = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot.id }, ctx);
    const reveal = res.events.find((e) => e.type === "lot:reveal");
    expect(reveal).toMatchObject({ bids: [{ teamId: "t1", amount: 50 }] });
  });

  it('revealTopN = "all" shows every bid', () => {
    const { state, ctx, lot } = openLotFixture(3, { revealTopN: "all" });
    let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 30 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t3", lotId: lot.id, amount: 10 }, ctx).state;
    const res = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot.id }, ctx);
    const reveal = res.events.find((e) => e.type === "lot:reveal") as { bids: unknown[] };
    expect(reveal.bids).toHaveLength(3);
  });

  it("fewer bids than revealTopN: no padding", () => {
    const { state, ctx, lot } = openLotFixture(3, { revealTopN: 3 });
    const res = applyLotExpired(
      applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 10 }, ctx).state,
      { type: "clock:lotExpired", lotId: lot.id },
      ctx,
    );
    const reveal = res.events.find((e) => e.type === "lot:reveal") as { bids: unknown[] };
    expect(reveal.bids).toHaveLength(1);
  });

  it("clock:lotExpired is a no-op for an unknown or already-closed lot", () => {
    const { state, ctx } = openLotFixture(3);
    const res = applyLotExpired(state, { type: "clock:lotExpired", lotId: "not-a-real-lot" }, ctx);
    expect(res.state).toBe(state);
    expect(res.events).toEqual([]);
  });
});
