import { describe, it, expect } from "vitest";
import { makeCtx, makePlayerPool, makeState, nominateFullRound } from "../helpers.js";
import { applyAdminStart } from "../../src/rules/start.js";
import { applyNominate } from "../../src/rules/nomination.js";
import { applyAdminBreak, applyAdminPause, applyAdminResume, BACK_IN_MS } from "../../src/rules/pauseResume.js";
import { REVEAL_HOLD_MS } from "../../src/clock.js";
import { applyBidSubmit } from "../../src/rules/bidding.js";
import { applyLotExpired } from "../../src/rules/reveal.js";
import { beginSnake, applyPickMake } from "../../src/rules/snake.js";
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

describe("pause / resume / break", () => {
  it("pausing during an open lot freezes its clock and locks bid entry", () => {
    const { state, ctx, lot } = openLotFixture();
    const laterCtx = { ...ctx, now: ctx.now + 20_000 };
    const res = applyAdminPause(state, { type: "admin:pause" }, laterCtx);
    expect(res.state.paused).toBe(true);
    const pausedLot = res.state.lots.find((l) => l.id === lot.id)!;
    expect(pausedLot.endsAt).toBeNull();
    expect(pausedLot.remainingMs).toBe(lot.endsAt! - laterCtx.now);
    expect(res.events).toContainEqual({ type: "draft:paused", remainingMs: pausedLot.remainingMs, breakEndsAt: null });
    // New bid submissions being locked out while paused is enforced by
    // reduce.ts's pause gate, exercised in reduce.test.ts.
  });

  it("pausing during a nomination turn freezes the nomination clock", () => {
    const players = makePlayerPool("QB", 10);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    const laterCtx = { ...ctx, now: ctx.now + 5000 };
    const res = applyAdminPause(state, { type: "admin:pause" }, laterCtx);
    expect(res.state.nominationEndsAt).toBeNull();
    expect(res.state.nominationRemainingMs).toBe(state.nominationEndsAt! - laterCtx.now);
  });

  it("resume restores endsAt from now + remainingMs", () => {
    const { state, ctx, lot } = openLotFixture();
    const pauseCtx = { ...ctx, now: ctx.now + 20_000 };
    let s = applyAdminPause(state, { type: "admin:pause" }, pauseCtx).state;
    const remainingMs = s.lots.find((l) => l.id === lot.id)!.remainingMs!;
    const resumeCtx = { ...pauseCtx, now: pauseCtx.now + 60_000 };
    const res = applyAdminResume(s, { type: "admin:resume" }, resumeCtx);
    expect(res.state.paused).toBe(false);
    const resumedLot = res.state.lots.find((l) => l.id === lot.id)!;
    expect(resumedLot.endsAt).toBe(resumeCtx.now + BACK_IN_MS + remainingMs);
    expect(resumedLot.remainingMs).toBeNull();
    expect(res.events).toContainEqual({ type: "draft:resumed", endsAt: resumedLot.endsAt });
  });

  it("a timed break pauses and sets breakEndsAt; the draft does not auto-resume when it passes", () => {
    const { state, ctx } = openLotFixture();
    const res = applyAdminBreak(state, { type: "admin:break", minutes: 15 }, ctx);
    expect(res.state.paused).toBe(true);
    expect(res.state.breakEndsAt).toBe(ctx.now + 15 * 60_000);
    // Time passes well beyond the break, but nothing resumes it automatically.
    expect(res.state.paused).toBe(true);
  });

  it("pausing during a tie rebid freezes the tie clock", () => {
    const { state, ctx, lot } = openLotFixture();
    let s = applyBidSubmit(state, { type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyBidSubmit(s, { type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 50 }, ctx).state;
    s = applyLotExpired(s, { type: "clock:lotExpired", lotId: lot.id }, ctx).state;
    expect(s.lots.find((l) => l.id === lot.id)?.state).toBe("tieRebid");
    const tieEndsAt = s.lots.find((l) => l.id === lot.id)!.endsAt!;
    // 5 s into the tie clock, which starts once the reveal has played.
    const laterCtx = { ...ctx, now: ctx.now + REVEAL_HOLD_MS + 5000 };
    const res = applyAdminPause(s, { type: "admin:pause" }, laterCtx);
    const pausedLot = res.state.lots.find((l) => l.id === lot.id)!;
    expect(pausedLot.endsAt).toBeNull();
    expect(pausedLot.remainingMs).toBe(tieEndsAt - laterCtx.now);
    expect(pausedLot.state).toBe("tieRebid");
  });

  it("pausing during a snake pick freezes the pick clock; resume restores it as a snake pick, not a tie rebid", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 0, rosterSize: 2, positionGroups: null } });
    const ctx = makeCtx(1000);
    state = beginSnake(state, ctx).state;
    const originalEndsAt = state.snakePickEndsAt!;
    const laterCtx = { ...ctx, now: ctx.now + 5000 };
    const paused = applyAdminPause(state, { type: "admin:pause" }, laterCtx);
    expect(paused.state.snakePickEndsAt).toBeNull();
    expect(paused.state.snakePickRemainingMs).toBe(originalEndsAt - laterCtx.now);

    const resumeCtx = { ...laterCtx, now: laterCtx.now + 10_000 };
    const resumed = applyAdminResume(paused.state, { type: "admin:resume" }, resumeCtx);
    expect(resumed.state.snakePickEndsAt).toBe(resumeCtx.now + BACK_IN_MS + paused.state.snakePickRemainingMs!);
    expect(resumed.state.snakePickRemainingMs).toBeNull();

    const res = applyPickMake(resumed.state, { type: "pick:make", teamId: "t1", playerId: "qb1" }, resumeCtx);
    expect(res.events[0]).not.toMatchObject({ type: "draft:rejected" });
  });

  it("pausing with no clock currently running is a harmless no-remainingMs freeze", () => {
    const players = makePlayerPool("QB", 5);
    const state: DraftState = makeState({
      teamCount: 2,
      players,
      settings: { auctionSpots: 8, rosterSize: 17, nominationClockSec: "off" },
    });
    const ctx = makeCtx(1000);
    const started = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    expect(started.nominationEndsAt).toBeNull();
    const res = applyAdminPause(started, { type: "admin:pause" }, ctx);
    expect(res.state.paused).toBe(true);
    expect(res.events).toContainEqual({ type: "draft:paused", remainingMs: null, breakEndsAt: null });
  });

  it("admin:resume with nothing having been frozen is a harmless clear of the paused flag", () => {
    const { state } = openLotFixture();
    // Marked paused without anything actually being frozen first (defensive path).
    const paused: DraftState = { ...state, paused: true };
    const ctx = makeCtx(2_000_000);
    const res = applyAdminResume(paused, { type: "admin:resume" }, ctx);
    expect(res.state.paused).toBe(false);
    expect(res.events).toContainEqual({ type: "draft:resumed", endsAt: null });
  });

  it("double admin:pause is a silent no-op", () => {
    const { state, ctx } = openLotFixture();
    const once = applyAdminPause(state, { type: "admin:pause" }, ctx).state;
    const twice = applyAdminPause(once, { type: "admin:pause" }, { ...ctx, now: ctx.now + 5000 });
    expect(twice.state).toBe(once);
    expect(twice.events).toEqual([]);
  });

  it("admin:resume while not paused is a silent no-op", () => {
    const { state, ctx } = openLotFixture();
    const res = applyAdminResume(state, { type: "admin:resume" }, ctx);
    expect(res.state).toBe(state);
    expect(res.events).toEqual([]);
  });
});
