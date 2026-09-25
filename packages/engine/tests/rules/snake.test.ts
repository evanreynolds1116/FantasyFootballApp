import { describe, it, expect } from "vitest";
import { makeCtx, makePlayerPool, makeState } from "../helpers.js";
import { beginSnake, applyPickExpired, applyPickMake, totalSnakeRounds } from "../../src/rules/snake.js";
import type { DraftState, Pick, Player } from "../../src/model/types.js";

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

function fillerPlayers(prefix: string, count: number, position = "QB"): Player[] {
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix}${i}`, position }));
}

describe("snake draft phase", () => {
  it("turn-around order: last team of one round picks again first in the next", () => {
    const players = [...makePlayerPool("RB", 40)];
    let state: DraftState = makeState({
      teamCount: 3,
      players,
      settings: { auctionSpots: 8, rosterSize: 11, positionGroups: null },
    });
    state = {
      ...state,
      picks: [
        ...auctionPicksFor("t1", 8, "a1_"),
        ...auctionPicksFor("t2", 8, "a2_"),
        ...auctionPicksFor("t3", 8, "a3_"),
      ],
      players: [...players, ...fillerPlayers("a1_", 8), ...fillerPlayers("a2_", 8), ...fillerPlayers("a3_", 8)],
    };
    const ctx = makeCtx(1000);
    expect(totalSnakeRounds(state)).toBe(3);

    state = beginSnake(state, ctx).state;
    const seen: string[] = [];
    let i = 0;
    while (state.phase === "snake" && seen.length < 9) {
      const teamId = state.snakePickTurnTeamId!;
      seen.push(teamId);
      const playerId = players[i++]!.id;
      state = applyPickMake(state, { type: "pick:make", teamId, playerId }, ctx).state;
    }
    expect(seen).toEqual(["t1", "t2", "t3", "t3", "t2", "t1", "t1", "t2", "t3"]);
  });

  it("rejects pick:make from a team not on the clock", () => {
    let state: DraftState = makeState({
      teamCount: 2,
      players: makePlayerPool("RB", 10),
      settings: { auctionSpots: 8, rosterSize: 9, positionGroups: null },
    });
    state = { ...state, picks: [...auctionPicksFor("t1", 8, "a1_"), ...auctionPicksFor("t2", 8, "a2_")] };
    const ctx = makeCtx(1000);
    state = beginSnake(state, ctx).state;
    const res = applyPickMake(state, { type: "pick:make", teamId: "t2", playerId: "rb1" }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "NOT_YOUR_TURN" });
  });

  it("rejects a pick at an already-maxed position", () => {
    const players = [{ id: "qbX", name: "qbX", position: "QB" }, ...makePlayerPool("RB", 10)];
    let state: DraftState = makeState({
      teamCount: 2,
      players,
      settings: { auctionSpots: 8, rosterSize: 9, positionGroups: [{ name: "QB", positions: ["QB"], min: 0, max: 0 }] },
    });
    state = { ...state, picks: [...auctionPicksFor("t1", 8, "a1_"), ...auctionPicksFor("t2", 8, "a2_")] };
    const ctx = makeCtx(1000);
    state = beginSnake(state, ctx).state;
    const res = applyPickMake(state, { type: "pick:make", teamId: "t1", playerId: "qbX" }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "POSITION_LIMIT" });
  });

  it("rejects a pick that would make a remaining position minimum unreachable", () => {
    // 2 roster spots left, RB min still needs 2 — a non-RB pick must be rejected.
    const players = [{ id: "wr1", name: "wr1", position: "WR" }, ...makePlayerPool("RB", 5)];
    let state: DraftState = makeState({
      teamCount: 2,
      players,
      settings: {
        auctionSpots: 0,
        rosterSize: 2,
        positionGroups: [{ name: "RB", positions: ["RB"], min: 2, max: 2 }],
      },
    });
    const ctx = makeCtx(1000);
    state = beginSnake(state, ctx).state;
    const res = applyPickMake(state, { type: "pick:make", teamId: "t1", playerId: "wr1" }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "POSITION_LIMIT" });
  });

  it("pickExpiryAction = autoPick chooses the first valid available player", () => {
    const players = makePlayerPool("RB", 5);
    let state: DraftState = makeState({
      teamCount: 2,
      players,
      settings: { auctionSpots: 8, rosterSize: 9, pickExpiryAction: "autoPick", positionGroups: null },
    });
    state = { ...state, picks: [...auctionPicksFor("t1", 8, "a1_"), ...auctionPicksFor("t2", 8, "a2_")] };
    const ctx = makeCtx(1000);
    state = beginSnake(state, ctx).state;
    const res = applyPickExpired(state, { type: "clock:pickExpired", teamId: "t1" }, ctx);
    expect(res.events).toContainEqual(expect.objectContaining({ type: "pick:made", teamId: "t1", playerId: "rb1", source: "auto" }));
  });

  it("pickExpiryAction = skip: the team gets an end-of-round catch-up turn", () => {
    const players = makePlayerPool("RB", 10);
    let state: DraftState = makeState({
      teamCount: 3,
      players,
      settings: { auctionSpots: 8, rosterSize: 10, pickExpiryAction: "skip", positionGroups: null },
    });
    state = {
      ...state,
      picks: [...auctionPicksFor("t1", 8, "a1_"), ...auctionPicksFor("t2", 8, "a2_"), ...auctionPicksFor("t3", 8, "a3_")],
    };
    const ctx = makeCtx(1000);
    state = beginSnake(state, ctx).state;
    expect(state.snakePickTurnTeamId).toBe("t1");
    // t1's clock expires: skipped, deferred to end of round.
    state = applyPickExpired(state, { type: "clock:pickExpired", teamId: "t1" }, ctx).state;
    expect(state.deferredPicks).toContainEqual({ teamId: "t1", round: 1 });
    expect(state.snakePickTurnTeamId).toBe("t2");
    state = applyPickMake(state, { type: "pick:make", teamId: "t2", playerId: "rb1" }, ctx).state;
    expect(state.snakePickTurnTeamId).toBe("t3");
    state = applyPickMake(state, { type: "pick:make", teamId: "t3", playerId: "rb2" }, ctx).state;
    // Normal round-1 turns exhausted; t1's catch-up turn comes next, before round 2.
    expect(state.snakePickTurnTeamId).toBe("t1");
    state = applyPickMake(state, { type: "pick:make", teamId: "t1", playerId: "rb3" }, ctx).state;
    expect(state.deferredPicks).toHaveLength(0);
    expect(state.snakeRound).toBe(2);
  });

  it("a broke team's regular snake picks proceed normally, interleaved in turn order", () => {
    const players = makePlayerPool("RB", 10);
    let state: DraftState = makeState({
      teamCount: 2,
      players,
      settings: { auctionSpots: 8, rosterSize: 9, positionGroups: null },
    });
    // t2 is broke: only 5/8 auction spots filled.
    state = { ...state, picks: [...auctionPicksFor("t1", 8, "a1_"), ...auctionPicksFor("t2", 5, "a2_")] };
    const ctx = makeCtx(1000);
    state = beginSnake(state, ctx).state;
    expect(state.snakePickTurnTeamId).toBe("t1");
    state = applyPickMake(state, { type: "pick:make", teamId: "t1", playerId: "rb1" }, ctx).state;
    expect(state.snakePickTurnTeamId).toBe("t2");
    state = applyPickMake(state, { type: "pick:make", teamId: "t2", playerId: "rb2" }, ctx).state;
    expect(state.picks.filter((p) => p.teamId === "t2" && p.source === "snake")).toHaveLength(1);
  });

  it("transitions to makeup phase (not complete) when a broke team still owes auction spots", () => {
    const players = makePlayerPool("RB", 3);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 8 } });
    // rosterSize === auctionSpots: no regular snake rounds. t2 is broke (5/8).
    state = { ...state, picks: [...auctionPicksFor("t1", 8, "a1_"), ...auctionPicksFor("t2", 5, "a2_")] };
    const ctx = makeCtx(1000);
    const res = beginSnake(state, ctx);
    expect(res.events).toContainEqual({ type: "draft:phase", phase: "makeup" });
    expect(res.state.phase).toBe("makeup");
  });

  it("brokeTeamsFillAtEnd = false: completes immediately with the broke team short of a full roster", () => {
    const players = makePlayerPool("RB", 3);
    let state: DraftState = makeState({
      teamCount: 2,
      players,
      settings: { auctionSpots: 8, rosterSize: 8, brokeTeamsFillAtEnd: false },
    });
    state = { ...state, picks: [...auctionPicksFor("t1", 8, "a1_"), ...auctionPicksFor("t2", 5, "a2_")] };
    const ctx = makeCtx(1000);
    const res = beginSnake(state, ctx);
    expect(res.events).toContainEqual({ type: "draft:phase", phase: "complete" });
    expect(res.state.picks.filter((p) => p.teamId === "t2")).toHaveLength(5);
  });
});
