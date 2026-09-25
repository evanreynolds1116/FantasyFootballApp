import { describe, it, expect } from "vitest";
import { makeCtx, makePlayerPool, makeState } from "../helpers.js";
import { applyAdminStart } from "../../src/rules/start.js";
import { applyNominate, applyNominationExpired } from "../../src/rules/nomination.js";
import type { DraftState, Pick } from "../../src/model/types.js";

describe("nomination", () => {
  it("snake nomination order: round 1 ascending, round 2 descending, round 3 ascending", () => {
    const players = makePlayerPool("QB", 20);
    let state = makeState({ teamCount: 3, players, settings: { auctionSpots: 2, rosterSize: 5 } });
    const ctx = makeCtx(0);

    const started = applyAdminStart(state, { type: "admin:start" }, ctx);
    state = started.state;
    expect(state.nominationTurnTeamId).toBe("t1");

    // Round 1: t1, t2, t3 nominate in order.
    for (const teamId of ["t1", "t2", "t3"]) {
      expect(state.nominationTurnTeamId).toBe(teamId);
      const playerId = players.find((p) => !state.lots.some((l) => l.playerId === p.id))!.id;
      const res = applyNominate(state, { type: "nominate", teamId, playerId }, ctx);
      state = res.state;
    }

    // Round 1 nominations complete: lot 1 opens, so nominationTurnTeamId is cleared
    // and round 2 hasn't started yet (it starts once round 1's lots resolve).
    expect(state.nominationTurnTeamId).toBeNull();
    expect(state.lots.filter((l) => l.round === 1)).toHaveLength(3);
    expect(state.lots.find((l) => l.round === 1 && l.orderInRound === 1)?.state).toBe("open");
  });

  it("fixed nomination order: every round ascending", () => {
    const players = makePlayerPool("QB", 20);
    let state = makeState({
      teamCount: 3,
      players,
      settings: { auctionSpots: 2, rosterSize: 5, nominationOrder: "fixed" },
    });
    const ctx = makeCtx(0);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    expect(state.nominationTurnTeamId).toBe("t1");
    state = applyNominate(state, { type: "nominate", teamId: "t1", playerId: "qb1" }, ctx).state;
    expect(state.nominationTurnTeamId).toBe("t2");
    state = applyNominate(state, { type: "nominate", teamId: "t2", playerId: "qb2" }, ctx).state;
    expect(state.nominationTurnTeamId).toBe("t3");
  });

  it("a broke team is skipped from the nomination order", () => {
    const players = makePlayerPool("QB", 20);
    let state = makeState({ teamCount: 3, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    // t2 is broke: spent down to $2 left, spots still open.
    const picks: Pick[] = [
      { id: "p1", pickNo: 1, round: 0, teamId: "t2", playerId: "sink", source: "auction", price: 998, madeAt: 0 },
    ];
    state = { ...state, players: [...players, { id: "sink", name: "sink", position: "QB" }], picks };
    const ctx = makeCtx(0);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    expect(state.nominationTurnTeamId).toBe("t1");
    state = applyNominate(state, { type: "nominate", teamId: "t1", playerId: "qb1" }, ctx).state;
    // t2 is broke and skipped; t3 is next.
    expect(state.nominationTurnTeamId).toBe("t3");
  });

  it("a team with auction spots already full is skipped from the nomination order", () => {
    const players = makePlayerPool("QB", 20);
    let state = makeState({ teamCount: 3, players, settings: { auctionSpots: 1, rosterSize: 5 } });
    const picks: Pick[] = [
      { id: "p1", pickNo: 1, round: 0, teamId: "t2", playerId: "sink", source: "auction", price: 5, madeAt: 0 },
    ];
    state = { ...state, players: [...players, { id: "sink", name: "sink", position: "QB" }], picks };
    const ctx = makeCtx(0);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    state = applyNominate(state, { type: "nominate", teamId: "t1", playerId: "qb1" }, ctx).state;
    expect(state.nominationTurnTeamId).toBe("t3");
  });

  it("rejects nominate from a team not on the clock (NOT_YOUR_TURN)", () => {
    const players = makePlayerPool("QB", 5);
    let state = makeState({ teamCount: 2, players, settings: { auctionSpots: 2, rosterSize: 5 } });
    const ctx = makeCtx(0);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    const res = applyNominate(state, { type: "nominate", teamId: "t2", playerId: "qb1" }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "NOT_YOUR_TURN" });
    expect(res.state).toBe(state);
  });

  it("rejects nominate of an already-lotted player (PLAYER_TAKEN)", () => {
    const players = makePlayerPool("QB", 5);
    let state = makeState({ teamCount: 2, players, settings: { auctionSpots: 2, rosterSize: 5 } });
    const ctx = makeCtx(0);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    state = applyNominate(state, { type: "nominate", teamId: "t1", playerId: "qb1" }, ctx).state;
    // Round not complete yet (t2 hasn't gone), so qb1 is in-flight on a queued lot.
    const res = applyNominate(state, { type: "nominate", teamId: "t2", playerId: "qb1" }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "PLAYER_TAKEN" });
  });

  it("rejects nominate outside the auction phase (INVALID_PHASE)", () => {
    const state: DraftState = makeState({ teamCount: 2, players: makePlayerPool("QB", 5) });
    const ctx = makeCtx(0);
    const res = applyNominate(state, { type: "nominate", teamId: "t1", playerId: "qb1" }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "INVALID_PHASE" });
  });

  it("clock:nominationExpired auto-nominates the first available player (insertion-order placeholder)", () => {
    const players = makePlayerPool("QB", 5);
    let state = makeState({ teamCount: 2, players, settings: { auctionSpots: 2, rosterSize: 5 } });
    const ctx = makeCtx(0);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    const res = applyNominationExpired(state, { type: "clock:nominationExpired" }, ctx);
    state = res.state;
    expect(state.lots.some((l) => l.playerId === "qb1" && l.nominatedByTeamId === "t1")).toBe(true);
  });

  it("a round with fewer eligible teams than total teams still runs correctly", () => {
    const players = makePlayerPool("QB", 20);
    let state = makeState({ teamCount: 4, players, settings: { auctionSpots: 1, rosterSize: 5 } });
    // t1 and t3 are already full going into the draft.
    const picks: Pick[] = [
      { id: "p1", pickNo: 1, round: 0, teamId: "t1", playerId: "sink1", source: "auction", price: 5, madeAt: 0 },
      { id: "p2", pickNo: 2, round: 0, teamId: "t3", playerId: "sink2", source: "auction", price: 5, madeAt: 0 },
    ];
    state = {
      ...state,
      players: [...players, { id: "sink1", name: "sink1", position: "QB" }, { id: "sink2", name: "sink2", position: "QB" }],
      picks,
    };
    const ctx = makeCtx(0);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    expect(state.nominationTurnTeamId).toBe("t2");
    state = applyNominate(state, { type: "nominate", teamId: "t2", playerId: "qb1" }, ctx).state;
    expect(state.nominationTurnTeamId).toBe("t4");
    state = applyNominate(state, { type: "nominate", teamId: "t4", playerId: "qb2" }, ctx).state;
    // Only 2 eligible teams: round complete after 2 nominations, lot 1 opens.
    expect(state.nominationTurnTeamId).toBeNull();
    expect(state.lots.filter((l) => l.round === 1)).toHaveLength(2);
  });

  it("defensively rejects nominate NOT_ELIGIBLE if the team on the clock somehow isn't eligible", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
    const ctx = makeCtx(0);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    // Force an inconsistent state: t1 is on the clock but already broke.
    state = {
      ...state,
      picks: [{ id: "p1", pickNo: 1, round: 0, teamId: "t1", playerId: "sink", source: "auction", price: 997, madeAt: 0 }],
      players: [...players, { id: "sink", name: "sink", position: "QB" }],
    };
    const res = applyNominate(state, { type: "nominate", teamId: "t1", playerId: "qb1" }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "NOT_ELIGIBLE" });
  });

  it("clock:nominationExpired is a no-op outside the auction phase or with no team on the clock", () => {
    const state = makeState({ teamCount: 2, players: makePlayerPool("QB", 5) });
    const ctx = makeCtx(0);
    const res = applyNominationExpired(state, { type: "clock:nominationExpired" }, ctx);
    expect(res.state).toBe(state);
    expect(res.events).toEqual([]);
  });

  it("clock:nominationExpired is a no-op if the player pool is exhausted", () => {
    let state = makeState({ teamCount: 2, players: [], settings: { auctionSpots: 1, rosterSize: 1 } });
    const ctx = makeCtx(0);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    const res = applyNominationExpired(state, { type: "clock:nominationExpired" }, ctx);
    expect(res.state).toBe(state);
    expect(res.events).toEqual([]);
  });
});
