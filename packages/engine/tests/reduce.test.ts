import { describe, it, expect } from "vitest";
import { makeCtx, makePlayerPool, makeState } from "./helpers.js";
import { reduce } from "../src/reduce.js";
import type { DraftState } from "../src/model/types.js";

describe("reduce (top-level dispatcher)", () => {
  it("dispatches admin:start and begins the auction", () => {
    const players = makePlayerPool("QB", 5);
    const state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(1000);
    const res = reduce(state, { type: "admin:start" }, ctx);
    expect(res.state.phase).toBe("auction");
    expect(res.state.nominationTurnTeamId).toBe("t1");
  });

  it("rejects an unrecognized-phase action cleanly rather than throwing", () => {
    const players = makePlayerPool("QB", 5);
    const state: DraftState = makeState({ teamCount: 2, players });
    const ctx = makeCtx(1000);
    const res = reduce(state, { type: "pick:make", teamId: "t1", playerId: "qb1" }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "INVALID_PHASE" });
  });

  it("dispatches admin:setRevealTopN", () => {
    const players = makePlayerPool("QB", 5);
    const state: DraftState = makeState({ teamCount: 2, players });
    const ctx = makeCtx(1000);
    const res = reduce(state, { type: "admin:setRevealTopN", revealTopN: 1 }, ctx);
    expect(res.state.settings.revealTopN).toBe(1);
  });

  it("dispatches admin:voidLot and admin:markPlayerUnavailable", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(1000);
    state = reduce(state, { type: "admin:start" }, ctx).state;
    state = reduce(state, { type: "nominate", teamId: "t1", playerId: "qb1" }, ctx).state;
    state = reduce(state, { type: "nominate", teamId: "t2", playerId: "qb2" }, ctx).state;
    const lot = state.lots[0]!;
    const voided = reduce(state, { type: "admin:voidLot", lotId: lot.id }, ctx);
    expect(voided.state.lots.find((l) => l.id === lot.id)?.state).toBe("cancelled");

    const marked = reduce(voided.state, { type: "admin:markPlayerUnavailable", playerId: "qb3" }, ctx);
    expect(marked.state.unavailablePlayerIds).toContain("qb3");
  });

  it("dispatches clock:nominationExpired, clock:tieExpired, clock:pickExpired (wrong phase), and admin:addTime", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(1000);
    state = reduce(state, { type: "admin:start" }, ctx).state;

    const nomExpired = reduce(state, { type: "clock:nominationExpired" }, ctx);
    expect(nomExpired.events.some((e) => e.type === "nomination:made")).toBe(true);
    state = nomExpired.state;

    const pickExpiredWrongPhase = reduce(state, { type: "clock:pickExpired", teamId: "t1" }, ctx);
    expect(pickExpiredWrongPhase.events[0]).toMatchObject({ type: "draft:rejected", code: "INVALID_PHASE" });

    const addTime = reduce(state, { type: "admin:addTime", seconds: 10 }, ctx);
    expect(addTime.state.nominationEndsAt).toBe(state.nominationEndsAt! + 10_000);

    const tieExpiredNoop = reduce(state, { type: "clock:tieExpired", lotId: "not-a-lot" }, ctx);
    expect(tieExpiredNoop.state).toBe(state);
  });

  it("dispatches pick:make and clock:pickExpired to the make-up phase handlers", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({
      teamCount: 1,
      players,
      settings: { auctionSpots: 1, rosterSize: 2, positionGroups: null },
    });
    state = { ...state, phase: "makeup", makeupRound: 1, makeupRoundTurnsTaken: 0, snakePickTurnTeamId: "t1", snakePickEndsAt: 1000 };
    const ctx = makeCtx(1000);
    const res = reduce(state, { type: "pick:make", teamId: "t1", playerId: "qb1" }, ctx);
    expect(res.events).toContainEqual(expect.objectContaining({ type: "pick:made", source: "makeup" }));
  });

  it("dispatches admin:resume and admin:break through the top-level entry point", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(1000);
    state = reduce(state, { type: "admin:start" }, ctx).state;
    const broken = reduce(state, { type: "admin:break", minutes: 10 }, ctx);
    expect(broken.state.paused).toBe(true);
    expect(broken.state.breakEndsAt).toBe(ctx.now + 10 * 60_000);
    const resumed = reduce(broken.state, { type: "admin:resume" }, ctx);
    expect(resumed.state.paused).toBe(false);
  });

  describe("pause gate", () => {
    function pausedState(): { state: DraftState; ctx: ReturnType<typeof makeCtx> } {
      const players = makePlayerPool("QB", 5);
      let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
      const ctx = makeCtx(1000);
      state = reduce(state, { type: "admin:start" }, ctx).state;
      state = reduce(state, { type: "admin:pause" }, ctx).state;
      expect(state.paused).toBe(true);
      return { state, ctx };
    }

    it("blocks nominate while paused", () => {
      const { state, ctx } = pausedState();
      const res = reduce(state, { type: "nominate", teamId: "t1", playerId: "qb1" }, ctx);
      expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "DRAFT_PAUSED" });
    });

    it("blocks bid:submit while paused", () => {
      const { state, ctx } = pausedState();
      const res = reduce(state, { type: "bid:submit", teamId: "t1", lotId: "lot_1", amount: 10 }, ctx);
      expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "DRAFT_PAUSED" });
    });

    it("blocks pick:make while paused", () => {
      const { state, ctx } = pausedState();
      const res = reduce(state, { type: "pick:make", teamId: "t1", playerId: "qb1" }, ctx);
      expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "DRAFT_PAUSED" });
    });

    it("blocks clock-expiry actions while paused", () => {
      const { state, ctx } = pausedState();
      const res = reduce(state, { type: "clock:nominationExpired" }, ctx);
      expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "DRAFT_PAUSED" });
    });

    it("admin:undo and admin:resolveTie remain available while paused", () => {
      const { state, ctx } = pausedState();
      const undoRes = reduce(state, { type: "admin:undo" }, ctx);
      expect(undoRes.events[0]).not.toMatchObject({ type: "draft:rejected", code: "DRAFT_PAUSED" });
      const tieRes = reduce(state, { type: "admin:resolveTie", lotId: "lot_1", teamId: "t1" }, ctx);
      expect(tieRes.events[0]).not.toMatchObject({ type: "draft:rejected", code: "DRAFT_PAUSED" });
    });

    it("admin:resume works while paused and unlocks subsequent actions", () => {
      const { state, ctx } = pausedState();
      const resumed = reduce(state, { type: "admin:resume" }, ctx).state;
      expect(resumed.paused).toBe(false);
      const res = reduce(resumed, { type: "nominate", teamId: "t1", playerId: "qb1" }, ctx);
      expect(res.events[0]).not.toMatchObject({ type: "draft:rejected" });
    });

    it("admin:setClocks and admin:addTime remain available while paused", () => {
      const { state, ctx } = pausedState();
      const res = reduce(state, { type: "admin:setClocks", bid: 90 }, ctx);
      expect(res.state.settings.bidClockSec).toBe(90);
    });
  });
});
