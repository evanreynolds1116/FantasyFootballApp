import { describe, it, expect } from "vitest";
import { nominationOrderForRound, orderForRound, teamsByDraftNumber } from "../../src/selectors/order.js";
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
});
