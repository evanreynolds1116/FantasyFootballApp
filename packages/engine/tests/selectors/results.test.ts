import { describe, expect, it } from "vitest";
import type { Lot, Pick } from "../../src/model/types.js";
import { buildResultsCsv, draftLog, type PublicResultsView } from "../../src/selectors/results.js";

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
  { id: "p5", name: "=HYPERLINK(1)", position: "K" },
];

function lot(id: string, playerId: string, winner: string, price: number, tieRound = 0): Lot {
  return { id, round: 1, orderInRound: 1, playerId, nominatedByTeamId: "t1", state: "awarded", tieRound, endsAt: null, remainingMs: null, eligibleTeamIds: ["t1", "t2", "t3"], tiedTeamIds: [], winnerTeamId: winner, price };
}
/** A public bid: `amount` only when the reveal showed it. */
const bid = (lotId: string, teamId: string, amount: number | undefined, tieRound = 0) => ({ lotId, teamId, tieRound, superseded: false, ...(amount !== undefined ? { amount } : {}) });
const pick = (pickNo: number, teamId: string, playerId: string, source: Pick["source"], round: number, price: number | null): Pick => ({ id: `k${pickNo}`, pickNo, round, teamId, playerId, source, price, madeAt: 0 });

function view(): PublicResultsView {
  return {
    teams,
    players,
    lots: [lot("L1", "p1", "t2", 120), lot("L2", "p2", "t1", 60, 2), { ...lot("L3", "p4", "t3", 5), nominatedByTeamId: "t3" }],
    // L1: winner + one revealed runner-up; t3's bid stayed hidden (no amount).
    // L3: everyone passed — pass rows look like hidden bids (no amount).
    bids: [
      bid("L1", "t2", 120),
      bid("L1", "t1", 100),
      bid("L1", "t3", undefined),
      bid("L2", "t1", 50),
      bid("L2", "t3", 50),
      bid("L2", "t1", 60, 1),
      bid("L3", "t1", undefined),
      bid("L3", "t2", undefined),
    ],
    picks: [pick(2, "t1", "p2", "auction", 1, 60), pick(1, "t2", "p1", "auction", 1, 120), pick(3, "t3", "p4", "auction", 1, 5), pick(4, "t3", "p3", "auto", 2, null)],
    commishLog: [],
  };
}

describe("draftLog", () => {
  it("lists picks in draft order with only the revealed runner-up bids", () => {
    const log = draftLog(view());
    expect(log.map((e) => e.pickNo)).toEqual([1, 2, 3, 4]);
    expect(log[0]).toMatchObject({ stage: "Auction R1", teamNumber: 2, playerName: "Josh Allen", price: 120, note: "", runnerUps: [{ teamNumber: 1, amount: 100 }] });
  });

  it("notes tie-breaks, no-bid awards and auto-picks", () => {
    const log = draftLog(view());
    expect(log[1]).toMatchObject({ note: "tie-break (2 re-bid rounds)", runnerUps: [{ teamNumber: 3, amount: 50 }] });
    expect(log[2]).toMatchObject({ note: "no bids, nominator", price: 5 });
    expect(log[3]).toMatchObject({ stage: "Snake R2", note: "auto-pick", price: null });
  });

  it("marks players the commissioner added", () => {
    const v = view();
    v.picks.push(pick(5, "t1", "p5", "snake", 0, null));
    v.commishLog.push({ id: "edit_1", at: 0, kind: "assign", teamId: "t1", playerId: "p5", pickId: "k5", slot: "snake", price: null });
    expect(draftLog(v)[4]).toMatchObject({ stage: "Commissioner", note: "added by commissioner", runnerUps: [] });
  });
});

describe("buildResultsCsv", () => {
  it("writes one row per pick, quotes fields that need it, and lists the revealed runner-up bids", () => {
    const lines = buildResultsCsv(view()).trimEnd().split("\r\n");
    expect(lines[0]).toBe("pick,stage,team_number,team,player,position,nfl_team,price,note,revealed_runner_up_bids");
    expect(lines[1]).toBe('1,Auction R1,2,"Bravo, ""The Best""",Josh Allen,QB,BUF,120,,Team 1 $100');
    expect(lines[4]).toBe("4,Snake R2,3,Charlie,Leo Park,WR,MIA,,auto-pick,");
    expect(lines).toHaveLength(5);
  });

  it("never lets a spreadsheet run a field as a formula", () => {
    const v = view();
    v.picks.push(pick(5, "t1", "p5", "snake", 3, null));
    const last = buildResultsCsv(v).trimEnd().split("\r\n").at(-1)!;
    expect(last).toContain(",'=HYPERLINK(1),");
  });
});
