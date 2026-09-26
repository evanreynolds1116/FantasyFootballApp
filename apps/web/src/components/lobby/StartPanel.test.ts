import { DEFAULT_SETTINGS } from "@draft-app/engine";
import { describe, expect, it } from "vitest";
import type { LeagueDetail } from "../../lib/api";
import { startBlockers, unclaimedWarning } from "./StartPanel";

function league(over: { claimed?: boolean[]; playerCount?: number; settings?: Partial<LeagueDetail["settings"]> } = {}): LeagueDetail {
  const claimed = over.claimed ?? [true, true];
  return {
    id: "l1",
    name: "Test",
    isCommissioner: true,
    commissionerName: "Commish",
    inviteCode: "ABCDEFGH",
    settings: { ...DEFAULT_SETTINGS, teamCount: claimed.length, rosterSize: 3, auctionSpots: 1, positionGroups: null, ...over.settings },
    teams: claimed.map((c, i) => ({ id: `t${i + 1}`, name: `Team ${i + 1}`, draftNumber: i + 1, claimed: c, managerName: c ? "Someone" : null, isMine: false })),
    playerCount: over.playerCount ?? 100,
    draft: null,
  };
}

describe("startBlockers", () => {
  it("is clear when the pool can fill every roster", () => {
    expect(startBlockers(league({ playerCount: 6 }))).toEqual([]);
  });

  it("says how many more players the pool needs", () => {
    expect(startBlockers(league({ playerCount: 4 }))).toEqual(["Add at least 2 more players to the pool (6 needed to fill every roster)."]);
  });
});

describe("unclaimedWarning", () => {
  it("is null when every team has a manager", () => {
    expect(unclaimedWarning(league())).toBeNull();
  });

  it("explains auto-nominate and auto-pick for an open team", () => {
    expect(unclaimedWarning(league({ claimed: [true, false] }))).toBe(
      "Team 2 has no manager, so nobody can bid for it. Their nominations are made automatically when the nomination clock runs out. Their snake picks are auto-picked when the pick clock runs out.",
    );
  });

  it("warns that a clock set to off stalls the draft at their turn", () => {
    const warning = unclaimedWarning(league({ claimed: [false, true, false], settings: { nominationClockSec: "off", pickExpiryAction: "skip" } }));
    expect(warning).toBe(
      "2 teams (#1, #3) have no manager, so nobody can bid for them. Their snake picks are skipped when the pick clock runs out. With the nomination clock off, the draft will stop at their turn until you turn it on from the console.",
    );
  });
});
