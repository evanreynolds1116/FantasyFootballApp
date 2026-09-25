import { describe, it, expect } from "vitest";
import { createInitialState } from "../../src/model/state.js";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults.js";
import { auctionSpotsFilled, auctionSpotsRemaining, isBroke, maxBid, remainingBudget, spentByTeam } from "../../src/selectors/budget.js";
import type { DraftState, Pick, Team } from "../../src/model/types.js";

const teams: Team[] = [
  { id: "t1", draftNumber: 1, name: "Team 1" },
  { id: "t2", draftNumber: 2, name: "Team 2" },
];

function withPicks(state: DraftState, picks: Pick[]): DraftState {
  return { ...state, picks };
}

describe("budget selectors", () => {
  const base = createInitialState(DEFAULT_SETTINGS, teams, []);

  it("remainingBudget starts at the full starting budget", () => {
    expect(remainingBudget(base, "t1")).toBe(1000);
  });

  it("spentByTeam sums only priced picks for that team", () => {
    const state = withPicks(base, [
      { id: "p1", pickNo: 1, round: 1, teamId: "t1", playerId: "pl1", source: "auction", price: 50, madeAt: 0 },
      { id: "p2", pickNo: 2, round: 1, teamId: "t1", playerId: "pl2", source: "snake", price: null, madeAt: 0 },
      { id: "p3", pickNo: 3, round: 1, teamId: "t2", playerId: "pl3", source: "auction", price: 999, madeAt: 0 },
    ]);
    expect(spentByTeam(state, "t1")).toBe(50);
    expect(remainingBudget(state, "t1")).toBe(950);
    expect(maxBid(state, "t1")).toBe(950);
  });

  it("auctionSpotsFilled counts only auction-source picks", () => {
    const state = withPicks(base, [
      { id: "p1", pickNo: 1, round: 1, teamId: "t1", playerId: "pl1", source: "auction", price: 5, madeAt: 0 },
      { id: "p2", pickNo: 2, round: 1, teamId: "t1", playerId: "pl2", source: "snake", price: null, madeAt: 0 },
    ]);
    expect(auctionSpotsFilled(state, "t1")).toBe(1);
    expect(auctionSpotsRemaining(state, "t1")).toBe(7);
  });

  it("isBroke is false with a full budget", () => {
    expect(isBroke(base, "t1")).toBe(false);
  });

  it("isBroke is true when remaining budget is below minBid and spots remain", () => {
    const picks: Pick[] = [];
    // Spend down to $3 left (below $5 min bid), 1 auction spot filled, 7 remain.
    picks.push({ id: "p1", pickNo: 1, round: 1, teamId: "t1", playerId: "pl1", source: "auction", price: 997, madeAt: 0 });
    const state = withPicks(base, picks);
    expect(remainingBudget(state, "t1")).toBe(3);
    expect(auctionSpotsRemaining(state, "t1")).toBe(7);
    expect(isBroke(state, "t1")).toBe(true);
  });

  it("isBroke is false once all auction spots are filled, regardless of budget", () => {
    const picks: Pick[] = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      pickNo: i + 1,
      round: 1,
      teamId: "t1",
      playerId: `pl${i}`,
      source: "auction" as const,
      price: 124,
      madeAt: 0,
    }));
    const state = withPicks(base, picks);
    expect(remainingBudget(state, "t1")).toBe(1000 - 124 * 8);
    expect(auctionSpotsRemaining(state, "t1")).toBe(0);
    expect(isBroke(state, "t1")).toBe(false);
  });
});
