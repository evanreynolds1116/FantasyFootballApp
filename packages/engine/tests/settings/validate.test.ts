import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults.js";
import type { DraftSettings } from "../../src/settings/types.js";
import { validateSettings } from "../../src/settings/validate.js";

const fieldsWithIssues = (overrides: Record<string, unknown>) =>
  validateSettings({ ...DEFAULT_SETTINGS, ...overrides } as DraftSettings).map((i) => i.field);

describe("validateSettings (SPEC league settings table)", () => {
  it("accepts the league defaults", () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual([]);
  });

  it("enforces team count 2–20", () => {
    expect(fieldsWithIssues({ teamCount: 1 })).toContain("teamCount");
    expect(fieldsWithIssues({ teamCount: 21 })).toContain("teamCount");
    expect(fieldsWithIssues({ teamCount: 2 })).toEqual([]);
    expect(fieldsWithIssues({ teamCount: 20 })).toEqual([]);
  });

  it("enforces budget $1–$100,000 and whole numbers", () => {
    expect(fieldsWithIssues({ startingBudget: 0 })).toContain("startingBudget");
    expect(fieldsWithIssues({ startingBudget: 100_001 })).toContain("startingBudget");
    expect(fieldsWithIssues({ startingBudget: 99.5 })).toContain("startingBudget");
  });

  it("enforces roster 1–30 and auction spots 0 to roster size", () => {
    expect(fieldsWithIssues({ rosterSize: 31 })).toContain("rosterSize");
    expect(fieldsWithIssues({ auctionSpots: 18 })).toContain("auctionSpots");
    expect(fieldsWithIssues({ auctionSpots: 0 })).toEqual([]);
    expect(fieldsWithIssues({ auctionSpots: 17 })).toEqual([]);
  });

  it("enforces min bid ≥ 0, bid step ≥ 1, tie raise ≥ 1", () => {
    expect(fieldsWithIssues({ minBid: -1 })).toContain("minBid");
    expect(fieldsWithIssues({ minBid: 0 })).toEqual([]);
    expect(fieldsWithIssues({ bidStep: 0 })).toContain("bidStep");
    expect(fieldsWithIssues({ tieMinRaise: 0 })).toContain("tieMinRaise");
  });

  it("allows each clock off or within its own range", () => {
    expect(fieldsWithIssues({ nominationClockSec: "off", bidClockSec: "off", tieClockSec: "off", pickClockSec: "off" })).toEqual([]);
    expect(fieldsWithIssues({ nominationClockSec: 301 })).toContain("nominationClockSec");
    expect(fieldsWithIssues({ bidClockSec: 600 })).toEqual([]);
    expect(fieldsWithIssues({ bidClockSec: 601 })).toContain("bidClockSec");
    expect(fieldsWithIssues({ tieClockSec: 9 })).toContain("tieClockSec");
    expect(fieldsWithIssues({ pickClockSec: 5 })).toContain("pickClockSec");
  });

  it("allows unlimited tie rounds or 1–10", () => {
    expect(fieldsWithIssues({ maxTieRounds: null })).toEqual([]);
    expect(fieldsWithIssues({ maxTieRounds: 10 })).toEqual([]);
    expect(fieldsWithIssues({ maxTieRounds: 0 })).toContain("maxTieRounds");
    expect(fieldsWithIssues({ maxTieRounds: 11 })).toContain("maxTieRounds");
  });

  it("allows reveal of winner only, top N, or all", () => {
    expect(fieldsWithIssues({ revealTopN: 1 })).toEqual([]);
    expect(fieldsWithIssues({ revealTopN: "all" })).toEqual([]);
    expect(fieldsWithIssues({ revealTopN: 3, teamCount: 2 })).toEqual([]); // more than can bid just shows every bid
    expect(fieldsWithIssues({ revealTopN: 21 })).toContain("revealTopN");
    expect(fieldsWithIssues({ revealTopN: 0 })).toContain("revealTopN");
  });

  it("rejects unknown option values", () => {
    expect(fieldsWithIssues({ tieFallback: "coinFlip" })).toContain("tieFallback");
    expect(fieldsWithIssues({ nominationOrder: "random" })).toContain("nominationOrder");
    expect(fieldsWithIssues({ earlyClose: "yes" })).toContain("earlyClose");
  });

  it("allows position limits off", () => {
    expect(fieldsWithIssues({ positionGroups: null })).toEqual([]);
  });

  it("rejects position groups whose minimums can't fit the roster", () => {
    const issues = validateSettings({ ...DEFAULT_SETTINGS, rosterSize: 15 });
    expect(issues).toEqual([{ field: "positionGroups", message: expect.stringContaining("add up to 16") }]);
  });

  it("rejects malformed position groups", () => {
    const g = (over: Record<string, unknown>) => ({ name: "QB", positions: ["QB"], min: 1, max: 2, ...over });
    expect(fieldsWithIssues({ positionGroups: [] })).toContain("positionGroups");
    expect(fieldsWithIssues({ positionGroups: [g({ name: " " })] })).toContain("positionGroups");
    expect(fieldsWithIssues({ positionGroups: [g({ positions: [] })] })).toContain("positionGroups");
    expect(fieldsWithIssues({ positionGroups: [g({ min: 3, max: 2 })] })).toContain("positionGroups");
    expect(fieldsWithIssues({ positionGroups: [g({}), g({ name: "QB2" })] })).toContain("positionGroups"); // QB in two groups
    expect(fieldsWithIssues({ positionGroups: [g({}), g({ positions: ["RB"] })] })).toContain("positionGroups"); // duplicate name
    expect(fieldsWithIssues({ positionGroups: [g({}), g({ name: "RB", positions: ["RB"] })] })).toEqual([]);
  });
});
