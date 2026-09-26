import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults.js";

describe("DEFAULT_SETTINGS", () => {
  it("matches the league defaults from CLAUDE.md and SPEC.md", () => {
    expect(DEFAULT_SETTINGS.teamCount).toBe(12);
    expect(DEFAULT_SETTINGS.startingBudget).toBe(1000);
    expect(DEFAULT_SETTINGS.auctionSpots).toBe(8);
    expect(DEFAULT_SETTINGS.rosterSize).toBe(17);
    expect(DEFAULT_SETTINGS.minBid).toBe(5);
    expect(DEFAULT_SETTINGS.bidStep).toBe(1);
    expect(DEFAULT_SETTINGS.tieMinRaise).toBe(5);
    expect(DEFAULT_SETTINGS.noBidAction).toBe("awardNominator");
    expect(DEFAULT_SETTINGS.nominationOrder).toBe("snake");
    expect(DEFAULT_SETTINGS.nominationClockSec).toBe(30);
    expect(DEFAULT_SETTINGS.bidClockSec).toBe(60);
    expect(DEFAULT_SETTINGS.tieClockSec).toBe(30);
    expect(DEFAULT_SETTINGS.pickClockSec).toBe(60);
    expect(DEFAULT_SETTINGS.earlyClose).toBe(true);
    expect(DEFAULT_SETTINGS.maxTieRounds).toBeNull();
    expect(DEFAULT_SETTINGS.tieFallback).toBe("randomDraw");
    expect(DEFAULT_SETTINGS.revealTopN).toBe(3);
    expect(DEFAULT_SETTINGS.pickExpiryAction).toBe("autoPick");
    expect(DEFAULT_SETTINGS.brokeTeamsFillAtEnd).toBe(true);
  });

  it("has position groups matching the league's limits", () => {
    const groups = DEFAULT_SETTINGS.positionGroups;
    expect(groups).not.toBeNull();
    expect(groups).toEqual([
      { name: "QB", positions: ["QB"], min: 2, max: 2 },
      { name: "RB", positions: ["RB"], min: 4, max: 5 },
      { name: "WR/TE", positions: ["WR", "TE"], min: 6, max: 7 },
      { name: "K", positions: ["K"], min: 2, max: 2 },
      { name: "DEF", positions: ["DEF"], min: 2, max: 2 },
    ]);
  });

  it("has position group minimums summing to at most rosterSize, and maximums summing to at least rosterSize", () => {
    const groups = DEFAULT_SETTINGS.positionGroups!;
    const minSum = groups.reduce((sum, g) => sum + g.min, 0);
    const maxSum = groups.reduce((sum, g) => sum + g.max, 0);
    expect(minSum).toBeLessThanOrEqual(DEFAULT_SETTINGS.rosterSize);
    expect(maxSum).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.rosterSize);
  });

  it("has auctionSpots not exceeding rosterSize", () => {
    expect(DEFAULT_SETTINGS.auctionSpots).toBeLessThanOrEqual(DEFAULT_SETTINGS.rosterSize);
  });
});
