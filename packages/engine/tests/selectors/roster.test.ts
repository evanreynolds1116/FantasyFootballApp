import { describe, it, expect } from "vitest";
import { createInitialState } from "../../src/model/state.js";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults.js";
import {
  groupsBelowMinimum,
  remainingMinimumsReachable,
  rosterCount,
  rosterSpotsRemaining,
  wouldExceedPositionMax,
} from "../../src/selectors/roster.js";
import type { DraftState, Pick, Player, Team } from "../../src/model/types.js";

const teams: Team[] = [{ id: "t1", draftNumber: 1, name: "Team 1" }];
const players: Player[] = [
  { id: "qb1", name: "QB One", position: "QB" },
  { id: "qb2", name: "QB Two", position: "QB" },
  { id: "rb1", name: "RB One", position: "RB" },
];

function withPicks(state: DraftState, picks: Pick[]): DraftState {
  return { ...state, picks };
}

describe("roster selectors", () => {
  const base = createInitialState(DEFAULT_SETTINGS, teams, players);

  it("rosterCount/rosterSpotsRemaining reflect picks", () => {
    const state = withPicks(base, [
      { id: "p1", pickNo: 1, round: 1, teamId: "t1", playerId: "qb1", source: "auction", price: 10, madeAt: 0 },
    ]);
    expect(rosterCount(state, "t1")).toBe(1);
    expect(rosterSpotsRemaining(state, "t1")).toBe(16);
  });

  it("wouldExceedPositionMax is true once a group hits its max (QB 2-2)", () => {
    const state = withPicks(base, [
      { id: "p1", pickNo: 1, round: 1, teamId: "t1", playerId: "qb1", source: "auction", price: 10, madeAt: 0 },
      { id: "p2", pickNo: 2, round: 1, teamId: "t1", playerId: "qb2", source: "auction", price: 10, madeAt: 0 },
    ]);
    expect(wouldExceedPositionMax(state, "t1", "QB")).toBe(true);
    expect(wouldExceedPositionMax(state, "t1", "RB")).toBe(false);
  });

  it("wouldExceedPositionMax is always false when position groups are off", () => {
    const noLimits = createInitialState({ ...DEFAULT_SETTINGS, positionGroups: null }, teams, players);
    const state = withPicks(noLimits, [
      { id: "p1", pickNo: 1, round: 1, teamId: "t1", playerId: "qb1", source: "auction", price: 10, madeAt: 0 },
      { id: "p2", pickNo: 2, round: 1, teamId: "t1", playerId: "qb2", source: "auction", price: 10, madeAt: 0 },
    ]);
    expect(wouldExceedPositionMax(state, "t1", "QB")).toBe(false);
  });

  it("groupsBelowMinimum lists every group under its min", () => {
    // Fresh team: everything is below minimum.
    const groups = groupsBelowMinimum(base, "t1");
    expect(groups.map((g) => g.name).sort()).toEqual(["DEF", "K", "QB", "RB", "WR/TE"]);
  });

  it("remainingMinimumsReachable is true with plenty of spots left", () => {
    expect(remainingMinimumsReachable(base, "t1")).toBe(true);
  });

  it("remainingMinimumsReachable is false when a hypothetical pick would leave too few spots for remaining minimums", () => {
    // Fill roster to 16/17 spots with only QBs (never satisfying RB/WR-TE/K/DEF minimums),
    // leaving 1 spot remaining but many groups still below minimum.
    const picks: Pick[] = Array.from({ length: 16 }, (_, i) => ({
      id: `p${i}`,
      pickNo: i + 1,
      round: 1,
      teamId: "t1",
      playerId: `filler${i}`,
      source: "snake" as const,
      price: null,
      madeAt: 0,
    }));
    const playersWithFillers: Player[] = [
      ...players,
      ...Array.from({ length: 16 }, (_, i) => ({ id: `filler${i}`, name: `Filler ${i}`, position: "QB" })),
    ];
    const state = withPicks(createInitialState(DEFAULT_SETTINGS, teams, playersWithFillers), picks);
    expect(rosterSpotsRemaining(state, "t1")).toBe(1);
    // A hypothetical RB pick still leaves RB min unmet by 3, WR/TE unmet by 6, etc. with only 0 spots left.
    expect(remainingMinimumsReachable(state, "t1", "RB")).toBe(false);
  });
});
