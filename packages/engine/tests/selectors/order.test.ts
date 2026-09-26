import { describe, it, expect } from "vitest";
import { makeupOrderForRound, nominationOrderForRound, orderForRound, teamsByDraftNumber } from "../../src/selectors/order.js";
import { makeState } from "../helpers.js";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults.js";
import type { Team } from "../../src/model/types.js";

const teams: Team[] = [
  { id: "t3", draftNumber: 3, name: "C" },
  { id: "t1", draftNumber: 1, name: "A" },
  { id: "t2", draftNumber: 2, name: "B" },
];

describe("order selectors", () => {
  it("teamsByDraftNumber sorts ascending regardless of input order", () => {
    expect(teamsByDraftNumber(teams)).toEqual(["t1", "t2", "t3"]);
  });

  it("orderForRound: round 1 ascending, round 2 descending, round 3 ascending again", () => {
    const base = ["t1", "t2", "t3"];
    expect(orderForRound(base, 1)).toEqual(["t1", "t2", "t3"]);
    expect(orderForRound(base, 2)).toEqual(["t3", "t2", "t1"]);
    expect(orderForRound(base, 3)).toEqual(["t1", "t2", "t3"]);
  });

  it("orderForRound turn-around: last team of round N equals first team of round N+1", () => {
    const base = ["t1", "t2", "t3"];
    const round1 = orderForRound(base, 1);
    const round2 = orderForRound(base, 2);
    expect(round1[round1.length - 1]).toBe(round2[0]);
    const round3 = orderForRound(base, 3);
    expect(round2[round2.length - 1]).toBe(round3[0]);
  });

  it("orderForRound honors a non-default starting direction (continuing a prior snake)", () => {
    const base = ["t1", "t2", "t3"];
    expect(orderForRound(base, 1, -1)).toEqual(["t3", "t2", "t1"]);
    expect(orderForRound(base, 2, -1)).toEqual(["t1", "t2", "t3"]);
  });

  it("nominationOrderForRound: snake setting alternates by round", () => {
    const settings = { ...DEFAULT_SETTINGS, nominationOrder: "snake" as const };
    const base = ["t1", "t2", "t3"];
    expect(nominationOrderForRound(settings, base, 1)).toEqual(["t1", "t2", "t3"]);
    expect(nominationOrderForRound(settings, base, 2)).toEqual(["t3", "t2", "t1"]);
  });

  it("nominationOrderForRound: fixed setting is always ascending", () => {
    const settings = { ...DEFAULT_SETTINGS, nominationOrder: "fixed" as const };
    const base = ["t1", "t2", "t3"];
    expect(nominationOrderForRound(settings, base, 1)).toEqual(["t1", "t2", "t3"]);
    expect(nominationOrderForRound(settings, base, 2)).toEqual(["t1", "t2", "t3"]);
    expect(nominationOrderForRound(settings, base, 5)).toEqual(["t1", "t2", "t3"]);
  });

  it("makeupOrderForRound keeps the round's order fixed and projects the next round", () => {
    const base = makeState({ teamCount: 4, players: [], settings: { auctionSpots: 3, rosterSize: 3, positionGroups: null } });
    const pick = (teamId: string, source: "auction" | "makeup", round: number, n: number) => ({ id: `${teamId}_${source}_${n}`, pickNo: n, round, teamId, playerId: `${teamId}_${n}`, source, price: source === "auction" ? 5 : null, madeAt: 0 });
    // t1 full; t2 owes 1; t3 owes 2; t4 owes 2. Make-up round 1, descending (snake ended descending).
    const picks = [
      ...[1, 2, 3].map((n) => pick("t1", "auction", 1, n)),
      ...[1, 2].map((n) => pick("t2", "auction", 1, n)),
      pick("t3", "auction", 1, 1),
      pick("t4", "auction", 1, 1),
    ];
    let state = { ...base, phase: "makeup" as const, makeupRound: 1, snakeDirection: -1 as const, picks };
    expect(makeupOrderForRound(state)).toEqual(["t4", "t3", "t2"]);
    expect(makeupOrderForRound(state, 2)).toEqual(["t3", "t4"]); // t2 fills its only spot this round; round 2 flips direction

    // t4 and t3 pick; t2 still owes its pick — order unchanged for round 1.
    state = { ...state, picks: [...picks, pick("t4", "makeup", 1, 10), pick("t3", "makeup", 1, 11)] };
    expect(makeupOrderForRound(state)).toEqual(["t4", "t3", "t2"]);
    // t2 fills its last spot: it stays in round 1's order, so the turn counter still lines up.
    state = { ...state, picks: [...state.picks, pick("t2", "makeup", 1, 12)] };
    expect(makeupOrderForRound(state)).toEqual(["t4", "t3", "t2"]);
    expect(makeupOrderForRound(state, 2)).toEqual(["t3", "t4"]);
  });
});

