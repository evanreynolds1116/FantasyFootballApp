import { createInitialState, DEFAULT_SETTINGS, type DraftState, type Lot } from "@draft-app/engine";
import { describe, expect, it } from "vitest";
import { nominationSlots, unavailableReason } from "./nominationData";

const teams = [1, 2, 3, 4].map((n) => ({ id: `t${n}`, draftNumber: n, name: `Team ${n}` }));
const players = ["p1", "p2", "p3", "p4", "p5"].map((id, i) => ({ id, name: `Player ${i + 1}`, position: "RB" }));

function lot(id: string, orderInRound: number, playerId: string, by: string, round = 2): Lot {
  return { id, round, orderInRound, playerId, nominatedByTeamId: by, state: "queued", tieRound: 0, endsAt: null, remainingMs: null, eligibleTeamIds: [], tiedTeamIds: [], winnerTeamId: null, price: null };
}

/** Round 2 of a 4-team snake: nominations go 4 → 1. Team 4 and Team 3 are in; Team 2 is on the clock. */
function midRound(): DraftState {
  const base = createInitialState({ ...DEFAULT_SETTINGS, teamCount: 4, auctionSpots: 3, rosterSize: 3, positionGroups: null }, teams, players);
  return {
    ...base,
    phase: "auction",
    auctionRound: 2,
    nominationTurnTeamId: "t2",
    lots: [lot("L1", 1, "p1", "t4"), lot("L2", 2, "p2", "t3")],
    picks: [{ id: "k1", pickNo: 1, round: 1, teamId: "t1", playerId: "p5", source: "auction", price: 96, madeAt: 0 }],
    unavailablePlayerIds: ["p4"],
  };
}

describe("nominationSlots", () => {
  it("lists who nominated whom, who's on the clock, and who's still to come, in round order", () => {
    const slots = nominationSlots(midRound());
    expect(slots.map((s) => [s.order, s.kind, s.team?.draftNumber, s.kind === "nominated" ? s.player?.name : null])).toEqual([
      [1, "nominated", 4, "Player 1"],
      [2, "nominated", 3, "Player 2"],
      [3, "onClock", 2, null],
      [4, "upcoming", 1, null],
    ]);
  });
});

describe("unavailableReason", () => {
  it("is null for an available player", () => {
    expect(unavailableReason(midRound(), "p3")).toBeNull();
  });

  it("explains a player nominated this round", () => {
    expect(unavailableReason(midRound(), "p2")).toBe("Already nominated this round — Lot 2, by Team 3");
  });

  it("explains a drafted player and a player the commissioner marked unavailable", () => {
    expect(unavailableReason(midRound(), "p5")).toBe("Already drafted by Team 1 ($96)");
    expect(unavailableReason(midRound(), "p4")).toBe("Marked unavailable by the commissioner");
  });
});
