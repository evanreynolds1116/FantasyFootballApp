import { createInitialState, DEFAULT_SETTINGS, type Lot, type Pick } from "@draft-app/engine";
import { describe, expect, it } from "vitest";
import type { DraftSnapshot } from "../../lib/contracts";
import { activeClock, phaseSummary, shortPlayerName, undoConsequence, undoDescription } from "./consoleText";

const teams = [
  { id: "t1", draftNumber: 1, name: "Alpha" },
  { id: "t2", draftNumber: 2, name: "Bravo" },
];
const players = [
  { id: "p1", name: "Keenan Owens", position: "K" },
  { id: "p2", name: "Deshawn Carter", position: "RB" },
];

function snapshot(overrides: Partial<DraftSnapshot> = {}): DraftSnapshot {
  const base = createInitialState(DEFAULT_SETTINGS, teams, players);
  return { ...base, bids: [], myTeamId: null, isCommissioner: true, connectedTeamIds: [], myQueue: [], ...overrides };
}

function lot(overrides: Partial<Lot>): Lot {
  return {
    id: "lot_1",
    round: 3,
    orderInRound: 4,
    playerId: "p1",
    nominatedByTeamId: "t1",
    state: "open",
    tieRound: 0,
    endsAt: null,
    remainingMs: null,
    eligibleTeamIds: ["t1", "t2"],
    tiedTeamIds: [],
    winnerTeamId: null,
    price: null,
    ...overrides,
  };
}

const awardPick: Pick = { id: "pick_9", pickNo: 9, round: 3, teamId: "t2", playerId: "p1", source: "auction", price: 96, madeAt: 0 };

describe("shortPlayerName", () => {
  it("abbreviates the first name like the mockup", () => {
    expect(shortPlayerName("Keenan Owens")).toBe("K. Owens");
    expect(shortPlayerName("Amon-Ra St. Brown")).toBe("A. St. Brown");
    expect(shortPlayerName("Bears")).toBe("Bears");
  });
});

describe("phaseSummary", () => {
  it("names the live lot during the auction", () => {
    const s = snapshot({ phase: "auction", auctionRound: 3, lots: [lot({})] });
    expect(phaseSummary(s)).toBe("Auction · R3 · Lot 4");
  });

  it("names the nominating team while nominations are open", () => {
    const s = snapshot({ phase: "auction", auctionRound: 2, nominationTurnTeamId: "t2" });
    expect(phaseSummary(s)).toBe("Auction · R2 · Team 2 nominating");
  });

  it("counts the overall pick in the snake", () => {
    const s = snapshot({ phase: "snake", snakeRound: 2, picks: [awardPick] });
    expect(phaseSummary(s)).toBe("Snake · R2 · Pick 2");
  });
});

describe("activeClock", () => {
  it("prefers the live lot's clock", () => {
    const s = snapshot({ phase: "auction", lots: [lot({ endsAt: 5000 })], nominationEndsAt: 9000 });
    expect(activeClock(s)).toEqual({ endsAt: 5000, remainingMs: null });
  });

  it("reports the frozen time while paused", () => {
    const s = snapshot({ phase: "snake", paused: true, snakePickRemainingMs: 42_000 });
    expect(activeClock(s)).toEqual({ endsAt: null, remainingMs: 42_000 });
  });

  it("is empty when nothing is timed", () => {
    expect(activeClock(snapshot())).toEqual({ endsAt: null, remainingMs: null });
  });
});

describe("undoDescription", () => {
  it("is null when there's nothing to undo", () => {
    expect(undoDescription(snapshot())).toBeNull();
  });

  it("names the lot, winner, player and price of an award, in the mockup's wording", () => {
    const s = snapshot({
      phase: "auction",
      auctionRound: 3,
      lots: [lot({ state: "awarded", winnerTeamId: "t2", price: 96 })],
      picks: [awardPick],
      lastAwardOrPick: { kind: "award", lotId: "lot_1", pickId: "pick_9" },
    });
    expect(undoDescription(s)).toBe("Lot 4, Team 2 won K. Owens for $96");
    expect(undoConsequence(s)).toMatch(/back into the pool/);
    expect(undoConsequence(s)).toMatch(/pauses/);
  });

  it("names the round once the award is from an earlier round", () => {
    const s = snapshot({
      phase: "snake",
      auctionRound: 5,
      lots: [lot({ state: "awarded", winnerTeamId: "t2", price: 96 })],
      picks: [awardPick],
      lastAwardOrPick: { kind: "award", lotId: "lot_1", pickId: "pick_9" },
    });
    expect(undoDescription(s)).toBe("R3 Lot 4, Team 2 won K. Owens for $96");
  });

  it("names a snake pick", () => {
    const pick: Pick = { id: "pick_20", pickNo: 20, round: 1, teamId: "t1", playerId: "p2", source: "snake", price: null, madeAt: 0 };
    const s = snapshot({ phase: "snake", picks: [pick], lastAwardOrPick: { kind: "pick", pickId: "pick_20" } });
    expect(undoDescription(s)).toBe("Pick 20, Team 1 took D. Carter");
    expect(undoConsequence(s)).toMatch(/back into the pool/);
  });
});
