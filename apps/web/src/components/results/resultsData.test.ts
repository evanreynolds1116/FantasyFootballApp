import { createInitialState, DEFAULT_SETTINGS, type Lot, type Pick } from "@draft-app/engine";
import { describe, expect, it } from "vitest";
import type { DraftSnapshot, PublicBid } from "../../lib/contracts";
import { buildResultsCsv, draftLog } from "./resultsData";

const teams = [
  { id: "t1", draftNumber: 1, name: "Alpha" },
  { id: "t2", draftNumber: 2, name: 'Bravo, "The Best"' },
  { id: "t3", draftNumber: 3, name: "Charlie" },
];
const players = [
  { id: "p1", name: "Josh Allen", position: "QB", nflTeam: "BUF" },
  { id: "p2", name: "Sam Reed", position: "RB" },
  { id: "p3", name: "Leo Park", position: "WR", nflTeam: "MIA" },
  { id: "p4", name: "Ty Moss", position: "TE" },
];

function lot(id: string, playerId: string, winner: string, price: number, tieRound = 0): Lot {
  return { id, round: 1, orderInRound: 1, playerId, nominatedByTeamId: "t1", state: "awarded", tieRound, endsAt: null, remainingMs: null, eligibleTeamIds: ["t1", "t2", "t3"], tiedTeamIds: [], winnerTeamId: winner, price };
}
const bid = (lotId: string, teamId: string, amount: number | undefined, tieRound = 0): PublicBid => ({
  id: `${lotId}_${teamId}_${tieRound}`,
  lotId,
  teamId,
  tieRound,
  receivedAt: 0,
  superseded: false,
  hasBid: true,
  ...(amount !== undefined ? { amount } : {}),
});
const pick = (pickNo: number, teamId: string, playerId: string, source: Pick["source"], round: number, price: number | null): Pick => ({ id: `k${pickNo}`, pickNo, round, teamId, playerId, source, price, madeAt: 0 });

function snapshot(): DraftSnapshot {
  const base = createInitialState(DEFAULT_SETTINGS, teams, players);
  return {
    ...base,
    phase: "complete",
    lots: [lot("L1", "p1", "t2", 120), lot("L2", "p2", "t1", 60, 2), { ...lot("L3", "p4", "t3", 5), nominatedByTeamId: "t3" }],
    // L1: winner + one revealed runner-up; t3's bid stayed hidden (no amount in the snapshot).
    bids: [bid("L1", "t2", 120), bid("L1", "t1", 100), bid("L1", "t3", undefined), bid("L2", "t1", 50), bid("L2", "t3", 50), bid("L2", "t1", 60, 1)],
    picks: [pick(2, "t1", "p2", "auction", 1, 60), pick(1, "t2", "p1", "auction", 1, 120), pick(3, "t3", "p4", "auction", 1, 5), pick(4, "t3", "p3", "auto", 2, null)],
    myTeamId: null,
    isCommissioner: false,
    connectedTeamIds: [],
  };
}

describe("draftLog", () => {
  it("lists picks in draft order with only the revealed runner-up bids", () => {
    const log = draftLog(snapshot());
    expect(log.map((e) => e.pickNo)).toEqual([1, 2, 3, 4]);
    expect(log[0]).toMatchObject({ stage: "Auction R1", teamNumber: 2, playerName: "Josh Allen", price: 120, note: "", runnerUps: [{ teamNumber: 1, amount: 100 }] });
  });

  it("notes tie-breaks, no-bid awards and auto-picks", () => {
    const log = draftLog(snapshot());
    expect(log[1]).toMatchObject({ note: "tie-break (2 re-bid rounds)", runnerUps: [{ teamNumber: 3, amount: 50 }] });
    expect(log[2]).toMatchObject({ note: "no bids, nominator", price: 5 });
    expect(log[3]).toMatchObject({ stage: "Snake R2", note: "auto-pick", price: null });
  });
});

describe("buildResultsCsv", () => {
  it("writes one row per pick and quotes fields that need it", () => {
    const lines = buildResultsCsv(snapshot()).trimEnd().split("\r\n");
    expect(lines[0]).toBe("pick,stage,team_number,team,player,position,nfl_team,price,note");
    expect(lines[1]).toBe('1,Auction R1,2,"Bravo, ""The Best""",Josh Allen,QB,BUF,120,');
    expect(lines[4]).toBe("4,Snake R2,3,Charlie,Leo Park,WR,MIA,,auto-pick");
    expect(lines).toHaveLength(5);
  });
});
