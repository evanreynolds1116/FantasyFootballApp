import { createInitialState, DEFAULT_SETTINGS, type DraftSettings, type Pick } from "@draft-app/engine";
import { describe, expect, it } from "vitest";
import type { DraftSnapshot } from "../../lib/contracts";
import { acquiredLabel, groupLimitLabel, rosterByGroup, teamSummaries } from "./rosterData";

const teams = [
  { id: "t2", draftNumber: 2, name: "Bravo" },
  { id: "t1", draftNumber: 1, name: "Alpha" },
];
const players = [
  { id: "qb1", name: "Josh Allen", position: "QB", nflTeam: "BUF" },
  { id: "rb1", name: "Deshawn Carter", position: "RB" },
  { id: "te1", name: "Tyler Grant", position: "TE" },
  { id: "k1", name: "Keenan Owens", position: "K" },
  { id: "x1", name: "Mystery Man", position: "LS" },
];

function pick(overrides: Partial<Pick>): Pick {
  return { id: `pick_${Math.random()}`, pickNo: 1, round: 1, teamId: "t1", playerId: "qb1", source: "auction", price: 100, madeAt: 0, ...overrides };
}

function snapshot(picks: Pick[], settings: Partial<DraftSettings> = {}, myTeamId: string | null = "t1"): DraftSnapshot {
  const base = createInitialState({ ...DEFAULT_SETTINGS, startingBudget: 1000, auctionSpots: 3, minBid: 5, ...settings }, teams, players);
  return { ...base, phase: "auction", picks, bids: [], myTeamId, isCommissioner: false, connectedTeamIds: [] };
}

describe("teamSummaries", () => {
  it("lists teams in draft order with money left, max bid, spots and roster from the engine's selectors", () => {
    const s = snapshot([pick({ teamId: "t1", playerId: "qb1", price: 300 }), pick({ teamId: "t1", playerId: "rb1", source: "snake", price: null })]);
    const [alpha, bravo] = teamSummaries(s);
    expect(alpha).toMatchObject({ draftNumber: 1, moneyLeft: 700, maxBid: 700, auctionSpotsLeft: 2, rosterCount: 2, broke: false, isMe: true });
    expect(bravo).toMatchObject({ draftNumber: 2, moneyLeft: 1000, auctionSpotsLeft: 3, rosterCount: 0, isMe: false });
  });

  it("flags a team broke when it can't afford the minimum bid with auction spots still open", () => {
    const s = snapshot([pick({ teamId: "t2", playerId: "qb1", price: 997 })]);
    expect(teamSummaries(s).find((t) => t.id === "t2")).toMatchObject({ moneyLeft: 3, broke: true, auctionSpotsLeft: 2 });
  });

  it("stops calling a team broke once make-up picks have filled its auction spots", () => {
    const s = snapshot([
      pick({ teamId: "t2", playerId: "qb1", price: 997 }),
      pick({ teamId: "t2", playerId: "rb1", source: "makeup", price: null }),
      pick({ teamId: "t2", playerId: "te1", source: "makeup", price: null }),
    ]);
    expect(teamSummaries(s).find((t) => t.id === "t2")).toMatchObject({ auctionSpotsLeft: 0, broke: false });
  });
});

describe("rosterByGroup", () => {
  it("splits a roster by the league's position groups, in group order, with an Other bucket for strays", () => {
    const s = snapshot([
      pick({ teamId: "t1", playerId: "te1", price: 50 }),
      pick({ teamId: "t1", playerId: "qb1", price: 300 }),
      pick({ teamId: "t1", playerId: "x1", source: "snake", price: null }),
    ]);
    const groups = rosterByGroup(s, "t1");
    expect(groups.map((g) => g.label)).toEqual(["QB", "RB", "WR/TE", "K", "DEF", "Other"]);
    expect(groups.find((g) => g.label === "QB")!.entries.map((e) => e.player?.name)).toEqual(["Josh Allen"]);
    expect(groups.find((g) => g.label === "WR/TE")!.count).toBe(1);
    expect(groups.find((g) => g.label === "RB")!.entries).toEqual([]);
    expect(groups.find((g) => g.label === "Other")!.entries.map((e) => e.player?.name)).toEqual(["Mystery Man"]);
  });

  it("is one flat list when position limits are off", () => {
    const s = snapshot([pick({ teamId: "t1", playerId: "qb1" }), pick({ teamId: "t1", playerId: "k1" })], { positionGroups: null });
    const groups = rosterByGroup(s, "t1");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ label: "Roster", count: 2, group: null });
  });
});

describe("labels", () => {
  it("says how each player was acquired", () => {
    expect(acquiredLabel(pick({ source: "auction", price: 96 }))).toBe("$96");
    expect(acquiredLabel(pick({ source: "snake", round: 3, price: null }))).toBe("Snake R3");
    expect(acquiredLabel(pick({ source: "makeup", round: 1, price: null }))).toBe("Make-up R1");
    expect(acquiredLabel(pick({ source: "auto", round: 4, price: null }))).toBe("Auto-pick R4");
  });

  it("shows a group's count against a fixed or ranged limit", () => {
    const s = snapshot([pick({ teamId: "t1", playerId: "qb1" })]);
    const groups = rosterByGroup(s, "t1");
    expect(groupLimitLabel(groups.find((g) => g.label === "QB")!)).toBe("1 of 2");
    expect(groupLimitLabel(groups.find((g) => g.label === "RB")!)).toBe("0 of 4–5");
  });
});
