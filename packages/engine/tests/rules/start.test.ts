import { describe, it, expect } from "vitest";
import { makeCtx, makePlayerPool, makeState } from "../helpers.js";
import { applyAdminStart } from "../../src/rules/start.js";
import type { DraftState } from "../../src/model/types.js";

describe("admin:start", () => {
  it("rejects starting a draft that's already started", () => {
    const players = makePlayerPool("QB", 5);
    const state: DraftState = makeState({ teamCount: 2, players });
    const ctx = makeCtx(1000);
    const started = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    const res = applyAdminStart(started, { type: "admin:start" }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "INVALID_PHASE" });
  });

  it("skips straight to the snake phase when auctionSpots is 0", () => {
    const players = makePlayerPool("QB", 5);
    const state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 0, rosterSize: 1, positionGroups: null } });
    const ctx = makeCtx(1000);
    const res = applyAdminStart(state, { type: "admin:start" }, ctx);
    expect(res.events).toContainEqual({ type: "draft:phase", phase: "snake" });
    expect(res.state.phase).toBe("snake");
    expect(res.state.snakePickTurnTeamId).not.toBeNull();
  });

  it("goes straight to snake if every team is already full or broke when the draft starts", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 1, rosterSize: 2, positionGroups: null } });
    state = {
      ...state,
      picks: [
        { id: "p1", pickNo: 1, round: 0, teamId: "t1", playerId: "sink1", source: "auction", price: 5, madeAt: 0 },
        { id: "p2", pickNo: 2, round: 0, teamId: "t2", playerId: "sink2", source: "auction", price: 5, madeAt: 0 },
      ],
    };
    const ctx = makeCtx(1000);
    const res = applyAdminStart(state, { type: "admin:start" }, ctx);
    expect(res.events).toContainEqual({ type: "draft:phase", phase: "snake" });
  });
});
