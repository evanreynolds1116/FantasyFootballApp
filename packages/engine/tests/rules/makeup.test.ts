import { describe, it, expect } from "vitest";
import { makeCtx, makePlayerPool, makeState } from "../helpers.js";
import { beginSnake, applyPickMake as applySnakePickMake } from "../../src/rules/snake.js";
import { applyMakeupPickExpired, applyMakeupPickMake, beginMakeup } from "../../src/rules/makeup.js";
import type { DraftState, Pick } from "../../src/model/types.js";

function auctionPicksFor(teamId: string, count: number, prefix: string): Pick[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i}`,
    pickNo: i + 1,
    round: 1,
    teamId,
    playerId: `${prefix}${i}`,
    source: "auction" as const,
    price: 5,
    madeAt: 0,
  }));
}

describe("make-up rounds", () => {
  it("only broke teams participate; fully-funded teams are skipped entirely", () => {
    const players = makePlayerPool("RB", 10);
    let state: DraftState = makeState({
      teamCount: 3,
      players,
      settings: { auctionSpots: 8, rosterSize: 8, positionGroups: null },
    });
    state = {
      ...state,
      picks: [
        ...auctionPicksFor("t1", 8, "a1_"), // full
        ...auctionPicksFor("t2", 5, "a2_"), // broke, owes 3
        ...auctionPicksFor("t3", 8, "a3_"), // full
      ],
    };
    const ctx = makeCtx(1000);
    const res = beginSnake(state, ctx);
    expect(res.state.phase).toBe("makeup");
    expect(res.state.snakePickTurnTeamId).toBe("t2");
  });

  it("make-up order follows snake order among broke teams, continuing the direction the snake ended", () => {
    const players = makePlayerPool("RB", 20);
    let state: DraftState = makeState({
      teamCount: 4,
      players,
      settings: { auctionSpots: 8, rosterSize: 10, positionGroups: null },
    });
    // t1 and t4 are broke (owe 2 each); t2/t3 are full. rosterSize(10) -
    // auctionSpots(8) = 2 regular snake rounds: round 1 ascending
    // (t1,t2,t3,t4), round 2 descending (t4,t3,t2,t1) — the snake ends
    // descending, so make-up should continue descending among just [t1,t4].
    state = {
      ...state,
      picks: [
        ...auctionPicksFor("t1", 6, "a1_"),
        ...auctionPicksFor("t2", 8, "a2_"),
        ...auctionPicksFor("t3", 8, "a3_"),
        ...auctionPicksFor("t4", 6, "a4_"),
      ],
    };
    const ctx = makeCtx(1000);
    let s = beginSnake(state, ctx).state;
    let i = 0;
    while (s.phase === "snake") {
      const teamId = s.snakePickTurnTeamId!;
      const playerId = players[i++]!.id;
      s = applySnakePickMake(s, { type: "pick:make", teamId, playerId }, ctx).state;
    }
    expect(s.phase).toBe("makeup");
    expect(s.snakeDirection).toBe(-1);

    const seen: string[] = [];
    while (s.phase === "makeup") {
      const teamId = s.snakePickTurnTeamId!;
      seen.push(teamId);
      const playerId = players[i++]!.id;
      s = applyMakeupPickMake(s, { type: "pick:make", teamId, playerId }, ctx).state;
    }
    expect(seen).toEqual(["t4", "t1", "t1", "t4"]);
    expect(s.phase).toBe("complete");
  });

  it("make-up picks are restricted to positions still under the team's minimum", () => {
    const players = [
      { id: "rb1", name: "rb1", position: "RB" },
      { id: "wr1", name: "wr1", position: "WR" },
    ];
    let state: DraftState = makeState({
      teamCount: 1,
      players,
      settings: {
        auctionSpots: 1,
        rosterSize: 2,
        positionGroups: [{ name: "RB", positions: ["RB"], min: 1, max: 5 }],
      },
    });
    // t1 already has 1 non-auction pick (a WR) and 0/1 auction spots filled;
    // its one remaining make-up spot must satisfy the RB minimum.
    state = {
      ...state,
      picks: [{ id: "p1", pickNo: 1, round: 1, teamId: "t1", playerId: "wr1", source: "snake", price: null, madeAt: 0 }],
    };
    const ctx = makeCtx(1000);
    const started = beginMakeup(state, ctx);
    expect(started.state.snakePickTurnTeamId).toBe("t1");
    const res = applyMakeupPickMake(started.state, { type: "pick:make", teamId: "t1", playerId: "rb1" }, ctx);
    expect(res.events.some((e) => e.type === "draft:rejected")).toBe(false);
    expect(res.state.picks.some((p) => p.playerId === "rb1")).toBe(true);
  });

  it("draft completes immediately after the last make-up pick if it's the final open spot league-wide", () => {
    const players = makePlayerPool("RB", 3);
    const state: DraftState = makeState({
      teamCount: 1,
      players,
      settings: { auctionSpots: 1, rosterSize: 1, positionGroups: null },
    });
    const ctx = makeCtx(1000);
    const started = beginMakeup(state, ctx);
    const res = applyMakeupPickMake(started.state, { type: "pick:make", teamId: "t1", playerId: "rb1" }, ctx);
    expect(res.events).toContainEqual({ type: "draft:phase", phase: "complete" });
    expect(res.state.phase).toBe("complete");
  });

  it("pickExpiryAction = autoPick works during make-up too", () => {
    const players = makePlayerPool("RB", 3);
    const state: DraftState = makeState({
      teamCount: 1,
      players,
      settings: { auctionSpots: 1, rosterSize: 1, positionGroups: null, pickExpiryAction: "autoPick" },
    });
    const ctx = makeCtx(1000);
    const started = beginMakeup(state, ctx);
    const res = applyMakeupPickExpired(started.state, { type: "clock:pickExpired", teamId: "t1" }, ctx);
    expect(res.events).toContainEqual(expect.objectContaining({ type: "pick:made", source: "makeup" }));
  });
});
