import { describe, expect, it } from "vitest";
import { makeCtx, makePlayerPool, makeState } from "../helpers.js";
import { reduce } from "../../src/reduce.js";
import { applyMakeupPickExpired, beginMakeup } from "../../src/rules/makeup.js";
import { applyNominate, applyNominationExpired } from "../../src/rules/nomination.js";
import { applyAdminPause } from "../../src/rules/pauseResume.js";
import { applyQueueUpdate, MAX_QUEUE_LENGTH } from "../../src/rules/queue.js";
import { applyPickExpired, beginSnake } from "../../src/rules/snake.js";
import { applyAdminStart } from "../../src/rules/start.js";
import { availableQueue } from "../../src/selectors/queue.js";
import type { DraftState, Pick } from "../../src/model/types.js";

const ctx = makeCtx(1000);
const queue = (s: DraftState, teamId: string, playerIds: string[]) => applyQueueUpdate(s, { type: "queue:update", teamId, playerIds }, ctx);

describe("queue (FR-19)", () => {
  it("stores a team's ranked queue, dropping duplicates, and emits a private event", () => {
    const state = makeState({ teamCount: 2, players: makePlayerPool("QB", 5) });
    const res = queue(state, "t1", ["qb3", "qb1", "qb3"]);
    expect(res.state.queues).toEqual({ t1: ["qb3", "qb1"] });
    expect(res.events).toEqual([{ type: "queue:updated", teamId: "t1", playerIds: ["qb3", "qb1"] }]);
  });

  it("refuses unknown players, unknown teams, and oversized queues", () => {
    const state = makeState({ teamCount: 2, players: makePlayerPool("QB", 5) });
    expect(queue(state, "t1", ["nobody"]).events[0]).toMatchObject({ code: "INVALID_QUEUE" });
    expect(queue(state, "t9", ["qb1"]).events[0]).toMatchObject({ code: "INVALID_QUEUE" });
    const big = makeState({ teamCount: 2, players: makePlayerPool("QB", MAX_QUEUE_LENGTH + 1) });
    expect(queue(big, "t1", big.players.map((p) => p.id)).events[0]).toMatchObject({ code: "INVALID_QUEUE" });
  });

  it("stays editable while the draft is paused", () => {
    let state = makeState({ teamCount: 2, players: makePlayerPool("QB", 5) });
    state = applyAdminPause(state, { type: "admin:pause" }, ctx).state;
    const res = reduce(state, { type: "queue:update", teamId: "t1", playerIds: ["qb2"] }, ctx);
    expect(res.state.queues.t1).toEqual(["qb2"]);
  });

  it("availableQueue skips players who are taken or already nominated", () => {
    let state = makeState({ teamCount: 2, players: makePlayerPool("QB", 5), settings: { auctionSpots: 2, rosterSize: 2, positionGroups: null } });
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    state = queue(state, "t2", ["qb1", "qb2", "qb3"]).state;
    state = applyNominate(state, { type: "nominate", teamId: "t1", playerId: "qb1" }, ctx).state;
    expect(availableQueue(state, "t2")).toEqual(["qb2", "qb3"]);
  });

  it("auto-nominates the top available player in the queue when the nomination clock runs out", () => {
    let state = makeState({ teamCount: 2, players: makePlayerPool("QB", 5), settings: { auctionSpots: 2, rosterSize: 2, positionGroups: null } });
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    state = queue(state, "t2", ["qb1", "qb4"]).state;
    state = applyNominate(state, { type: "nominate", teamId: "t1", playerId: "qb1" }, ctx).state; // takes t2's first choice
    expect(state.nominationTurnTeamId).toBe("t2");
    const res = applyNominationExpired(state, { type: "clock:nominationExpired" }, ctx);
    expect(res.state.lots.map((l) => l.playerId)).toEqual(["qb1", "qb4"]);
  });

  it("without a queue, auto-nominate still takes the highest-ranked available player", () => {
    let state = makeState({ teamCount: 2, players: makePlayerPool("QB", 5), settings: { auctionSpots: 2, rosterSize: 2, positionGroups: null } });
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    const res = applyNominationExpired(state, { type: "clock:nominationExpired" }, ctx);
    expect(res.state.lots[0]!.playerId).toBe("qb1");
  });

  it("auto-picks the first queued player who fits the roster, skipping one who'd break a position max", () => {
    const players = [...makePlayerPool("QB", 3), ...makePlayerPool("RB", 3)];
    let state = makeState({
      teamCount: 2,
      players,
      settings: { auctionSpots: 0, rosterSize: 3, positionGroups: [{ name: "QB", positions: ["QB"], min: 0, max: 1 }, { name: "RB", positions: ["RB"], min: 0, max: 3 }] },
    });
    state = { ...state, picks: [{ id: "k0", pickNo: 1, round: 1, teamId: "t1", playerId: "qb3", source: "snake", price: null, madeAt: 0 } as Pick] };
    state = queue(state, "t1", ["qb1", "rb2"]).state; // qb1 would be a second QB (max 1)
    state = beginSnake(state, ctx).state;
    expect(state.snakePickTurnTeamId).toBe("t1");
    const res = applyPickExpired(state, { type: "clock:pickExpired", teamId: "t1" }, ctx);
    expect(res.state.picks.at(-1)).toMatchObject({ teamId: "t1", playerId: "rb2", source: "auto" });
  });

  it("with nothing usable in the queue, auto-pick falls back to the best available player", () => {
    let state = makeState({ teamCount: 2, players: makePlayerPool("RB", 6), settings: { auctionSpots: 0, rosterSize: 2, positionGroups: null } });
    state = beginSnake(state, ctx).state;
    const res = applyPickExpired(state, { type: "clock:pickExpired", teamId: "t1" }, ctx);
    expect(res.state.picks.at(-1)).toMatchObject({ teamId: "t1", playerId: "rb1" });
  });

  it("make-up auto-picks use the queue too", () => {
    let state = makeState({ teamCount: 2, players: makePlayerPool("RB", 10), settings: { auctionSpots: 2, rosterSize: 2, positionGroups: null } });
    const pick = (id: string, teamId: string, playerId: string): Pick => ({ id, pickNo: 1, round: 1, teamId, playerId, source: "auction", price: 5, madeAt: 0 });
    // t1 is full; t2 went broke with one auction spot left.
    state = { ...state, phase: "snake", snakeDirection: 1, picks: [pick("a", "t1", "rb1"), pick("b", "t1", "rb2"), pick("c", "t2", "rb3")] };
    state = queue(state, "t2", ["rb1", "rb8"]).state; // rb1 is already taken
    state = beginMakeup(state, ctx).state;
    expect(state.snakePickTurnTeamId).toBe("t2");
    const res = applyMakeupPickExpired(state, { type: "clock:pickExpired", teamId: "t2" }, ctx);
    expect(res.state.picks.at(-1)).toMatchObject({ teamId: "t2", playerId: "rb8", source: "makeup" });
  });
});
