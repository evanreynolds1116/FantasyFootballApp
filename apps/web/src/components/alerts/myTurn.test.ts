import { createInitialState, DEFAULT_SETTINGS, type Lot } from "@draft-app/engine";
import { describe, expect, it } from "vitest";
import type { DraftSnapshot, PublicBid } from "../../lib/contracts";
import { myTurn } from "./myTurn";

const teams = [
  { id: "t1", draftNumber: 1, name: "Alpha" },
  { id: "t2", draftNumber: 2, name: "Bravo" },
];
const players = [
  { id: "p1", name: "Josh Allen", position: "QB" },
  { id: "p2", name: "Deshawn Carter", position: "RB" },
];

function snapshot(overrides: Partial<DraftSnapshot> = {}): DraftSnapshot {
  const base = createInitialState(DEFAULT_SETTINGS, teams, players);
  return { ...base, phase: "auction", bids: [], myTeamId: "t1", isCommissioner: false, connectedTeamIds: [], myQueue: [], ...overrides };
}

function lot(overrides: Partial<Lot>): Lot {
  return {
    id: "lot_1",
    round: 1,
    orderInRound: 1,
    playerId: "p1",
    nominatedByTeamId: "t1",
    state: "open",
    tieRound: 0,
    endsAt: 50_000,
    remainingMs: null,
    eligibleTeamIds: ["t1", "t2"],
    tiedTeamIds: [],
    winnerTeamId: null,
    price: null,
    ...overrides,
  };
}

function bid(teamId: string, tieRound = 0): PublicBid {
  return { id: `b_${teamId}_${tieRound}`, lotId: "lot_1", teamId, tieRound, receivedAt: 0, superseded: false, hasBid: true };
}

describe("myTurn", () => {
  it("is your nomination turn only when the nomination clock is on you", () => {
    expect(myTurn(snapshot({ nominationTurnTeamId: "t1", nominationEndsAt: 30_000 }))).toMatchObject({ kind: "nominate", endsAt: 30_000 });
    expect(myTurn(snapshot({ nominationTurnTeamId: "t2", nominationEndsAt: 30_000 }))).toBeNull();
  });

  it("gives each nomination in a round its own key, so a second turn alerts again", () => {
    const first = myTurn(snapshot({ auctionRound: 1, nominationTurnTeamId: "t1" }))!;
    const second = myTurn(snapshot({ auctionRound: 1, nominationTurnTeamId: "t1", lots: [lot({ state: "queued" })] }))!;
    expect(first.key).not.toBe(second.key);
  });

  it("asks you to bid on an open lot you're eligible for until you bid or pass", () => {
    expect(myTurn(snapshot({ lots: [lot({})] }))).toMatchObject({ kind: "bid", key: "bid:lot_1", endsAt: 50_000 });
    expect(myTurn(snapshot({ lots: [lot({})], bids: [bid("t1")] }))).toBeNull();
    expect(myTurn(snapshot({ lots: [lot({ eligibleTeamIds: ["t2"] })] }))).toBeNull();
    // Someone else bidding doesn't count as you acting.
    expect(myTurn(snapshot({ lots: [lot({})], bids: [bid("t2")] }))).not.toBeNull();
  });

  it("asks only the tied teams to re-bid, once per tie round", () => {
    const tie = lot({ state: "tieRebid", tieRound: 1, tiedTeamIds: ["t1", "t2"], endsAt: 20_000 });
    expect(myTurn(snapshot({ lots: [tie], bids: [bid("t1", 0)] }))).toMatchObject({ kind: "tie", key: "tie:lot_1:1", endsAt: 20_000 });
    expect(myTurn(snapshot({ lots: [tie], bids: [bid("t1", 0), bid("t1", 1)] }))).toBeNull();
    expect(myTurn(snapshot({ lots: [{ ...tie, tiedTeamIds: ["t2"] }] }))).toBeNull();
  });

  it("is your pick in the snake and make-up phases when the pick clock is on you", () => {
    expect(myTurn(snapshot({ phase: "snake", snakePickTurnTeamId: "t1", snakePickEndsAt: 40_000 }))).toMatchObject({ kind: "pick", endsAt: 40_000 });
    expect(myTurn(snapshot({ phase: "makeup", snakePickTurnTeamId: "t1" }))).toMatchObject({ kind: "pick" });
    expect(myTurn(snapshot({ phase: "snake", snakePickTurnTeamId: "t2" }))).toBeNull();
  });

  it("never alerts a spectator or a finished draft", () => {
    expect(myTurn(snapshot({ myTeamId: null, nominationTurnTeamId: "t1" }))).toBeNull();
    expect(myTurn(snapshot({ phase: "complete", snakePickTurnTeamId: "t1" }))).toBeNull();
  });
});
