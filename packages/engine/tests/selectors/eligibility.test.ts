import { describe, it, expect } from "vitest";
import { createInitialState } from "../../src/model/state.js";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults.js";
import { canBidOnPlayer, canNominate, eligibleTeamIdsForPlayer, isFullOrBroke } from "../../src/selectors/eligibility.js";
import type { DraftState, Pick, Player, Team } from "../../src/model/types.js";

const teams: Team[] = [
  { id: "t1", draftNumber: 1, name: "Team 1" },
  { id: "t2", draftNumber: 2, name: "Team 2" },
];
const players: Player[] = [
  { id: "qb1", name: "QB One", position: "QB" },
  { id: "qb2", name: "QB Two", position: "QB" },
  { id: "qb3", name: "QB Three", position: "QB" },
];

function withPicks(state: DraftState, picks: Pick[]): DraftState {
  return { ...state, picks };
}

describe("eligibility selectors", () => {
  const base = createInitialState(DEFAULT_SETTINGS, teams, players);

  it("canNominate is true for a fresh team", () => {
    expect(canNominate(base, "t1")).toBe(true);
  });

  it("canNominate is false once auction spots are full", () => {
    const picks: Pick[] = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      pickNo: i + 1,
      round: 1,
      teamId: "t1",
      playerId: `x${i}`,
      source: "auction" as const,
      price: 5,
      madeAt: 0,
    }));
    const state = withPicks(base, picks);
    expect(canNominate(state, "t1")).toBe(false);
    expect(isFullOrBroke(state, "t1")).toBe(true);
  });

  it("canNominate is false once broke", () => {
    const state = withPicks(base, [
      { id: "p1", pickNo: 1, round: 1, teamId: "t1", playerId: "x1", source: "auction", price: 997, madeAt: 0 },
    ]);
    expect(canNominate(state, "t1")).toBe(false);
    expect(isFullOrBroke(state, "t1")).toBe(true);
  });

  it("canBidOnPlayer is false for a team already at that position's max", () => {
    const state = withPicks(base, [
      { id: "p1", pickNo: 1, round: 1, teamId: "t1", playerId: "qb1", source: "auction", price: 5, madeAt: 0 },
      { id: "p2", pickNo: 2, round: 1, teamId: "t1", playerId: "qb2", source: "auction", price: 5, madeAt: 0 },
    ]);
    expect(canBidOnPlayer(state, "t1", "qb3")).toBe(false);
    expect(canBidOnPlayer(state, "t2", "qb3")).toBe(true);
  });

  it("eligibleTeamIdsForPlayer returns only currently-eligible teams", () => {
    const state = withPicks(base, [
      { id: "p1", pickNo: 1, round: 1, teamId: "t1", playerId: "qb1", source: "auction", price: 5, madeAt: 0 },
      { id: "p2", pickNo: 2, round: 1, teamId: "t1", playerId: "qb2", source: "auction", price: 5, madeAt: 0 },
    ]);
    expect(eligibleTeamIdsForPlayer(state, "qb3")).toEqual(["t2"]);
  });
});
