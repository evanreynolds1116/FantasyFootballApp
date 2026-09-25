import { describe, it, expect } from "vitest";
import { makeCtx, makePlayerPool, makeState, nominateFullRound } from "../helpers.js";
import { applyAdminStart } from "../../src/rules/start.js";
import { applyNominate } from "../../src/rules/nomination.js";
import { applyAdminAddTime, applyAdminSetClocks, applyAdminSetRevealTopN } from "../../src/rules/clockAdmin.js";
import { applyBidSubmit } from "../../src/rules/bidding.js";
import { applyLotExpired } from "../../src/rules/reveal.js";
import { beginSnake } from "../../src/rules/snake.js";
import type { DraftState } from "../../src/model/types.js";

function openLotFixture() {
  const players = makePlayerPool("QB", 10);
  let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
  const ctx = makeCtx(1000);
  state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
  let i = 0;
  state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
  return { state, ctx, lot: state.lots[0]! };
}

describe("clock admin", () => {
  it("admin:setClocks updates settings and does not touch the currently-running lot's endsAt", () => {
    const { state, ctx, lot } = openLotFixture();
    const res = applyAdminSetClocks(state, { type: "admin:setClocks", bid: 90 }, ctx);
    expect(res.state.settings.bidClockSec).toBe(90);
    expect(res.state.lots.find((l) => l.id === lot.id)?.endsAt).toBe(lot.endsAt);
    expect(res.events).toContainEqual({
      type: "settings:clocks",
      nomination: res.state.settings.nominationClockSec,
      bid: 90,
      tie: res.state.settings.tieClockSec,
      pick: res.state.settings.pickClockSec,
    });
  });

  it("the next lot after a clock-length change uses the new length", () => {
    const players = makePlayerPool("QB", 10);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(1000);
    state = applyAdminSetClocks(state, { type: "admin:setClocks", nomination: 45 }, ctx).state;
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    expect(state.nominationEndsAt).toBe(ctx.now + 45 * 1000);
  });

  it("admin:addTime extends the currently-running lot clock by exactly N seconds", () => {
    const { state, ctx, lot } = openLotFixture();
    const res = applyAdminAddTime(state, { type: "admin:addTime", seconds: 15 }, ctx);
    expect(res.state.lots.find((l) => l.id === lot.id)?.endsAt).toBe(lot.endsAt! + 15_000);
  });

  it("admin:addTime extends the nomination clock", () => {
    const players = makePlayerPool("QB", 10);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    const before = state.nominationEndsAt!;
    const res = applyAdminAddTime(state, { type: "admin:addTime", seconds: 15 }, ctx);
    expect(res.state.nominationEndsAt).toBe(before + 15_000);
  });

  it("admin:addTime is a no-op when no clock is currently running", () => {
    const players = makePlayerPool("QB", 10);
    const state: DraftState = makeState({
      teamCount: 2,
      players,
      settings: { auctionSpots: 8, rosterSize: 17, nominationClockSec: "off" },
    });
    const ctx = makeCtx(1000);
    const started = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    expect(started.nominationEndsAt).toBeNull();
    const res = applyAdminAddTime(started, { type: "admin:addTime", seconds: 15 }, ctx);
    expect(res.state).toBe(started);
  });

  it("admin:addTime extends the tie-rebid clock", () => {
    const { state, ctx, lot } = openLotFixture();
    let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot.id }, ctx).state;
    const tieEndsAt = s.lots.find((l) => l.id === lot.id)!.endsAt!;
    const res = applyAdminAddTime(s, { type: "admin:addTime", seconds: 15 }, ctx);
    expect(res.state.lots.find((l) => l.id === lot.id)?.endsAt).toBe(tieEndsAt + 15_000);
  });

  it("admin:addTime extends the snake pick clock", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 0, rosterSize: 2, positionGroups: null } });
    const ctx = makeCtx(1000);
    state = beginSnake(state, ctx).state;
    const before = state.snakePickEndsAt!;
    const res = applyAdminAddTime(state, { type: "admin:addTime", seconds: 15 }, ctx);
    expect(res.state.snakePickEndsAt).toBe(before + 15_000);
  });

  it("admin:setRevealTopN updates the setting and emits settings:revealTopN", () => {
    const { state, ctx } = openLotFixture();
    const res = applyAdminSetRevealTopN(state, { type: "admin:setRevealTopN", revealTopN: 1 }, ctx);
    expect(res.state.settings.revealTopN).toBe(1);
    expect(res.events).toContainEqual({ type: "settings:revealTopN", revealTopN: 1 });
  });
});
