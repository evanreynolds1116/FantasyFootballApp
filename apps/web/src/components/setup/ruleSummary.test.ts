import { DEFAULT_SETTINGS } from "@draft-app/engine";
import { describe, expect, it } from "vitest";
import { summarizeRules } from "./ruleSummary";

describe("summarizeRules", () => {
  it("reads the league defaults back the way the league describes its rules", () => {
    expect(summarizeRules(DEFAULT_SETTINGS)).toEqual([
      "12 teams with $1,000 each buy 8 players at sealed-bid auction, then snake-draft 9 more for a 17-player roster.",
      "Position limits: QB 2, RB 4–5, WR/TE 6–7, K 2, DEF 2.",
      "Nominations snake: 1 → 12, then 12 → 1.",
      "Bids start at $5, any whole dollar; no one can bid past their budget or a position limit.",
      "Ties: only the tied teams re-bid, each raising their own bid by at least $5, for as many rounds as it takes.",
      "If every tied team is all-in, a random draw decides.",
      "If nobody bids, the nominator gets the player for $5 (unless they're full, then the player goes back in the pool).",
      "The reveal shows the winner and the next two bids.",
      "Bidding closes early (3-second last call) once everyone has bid.",
      "A team that can't afford $5 before filling its auction spots fills them with make-up picks after the snake.",
      "Clocks: nominate 30 s · bid 60 s · tie re-bid 30 s · pick 60 s.",
      "If the pick clock runs out, the app auto-picks the best available player that fits.",
    ]);
  });

  it("describes a straight snake with no auction rules", () => {
    const lines = summarizeRules({ ...DEFAULT_SETTINGS, auctionSpots: 0, positionGroups: null, pickClockSec: "off", pickExpiryAction: "skip" });
    expect(lines).toEqual([
      "12 teams, straight snake draft for a 17-player roster.",
      "No position limits.",
      "Clocks: pick off.",
      "If the pick clock runs out, that team is skipped and picks later.",
    ]);
  });

  it("covers the non-default auction options", () => {
    const lines = summarizeRules({
      ...DEFAULT_SETTINGS,
      nominationOrder: "fixed",
      bidStep: 5,
      maxTieRounds: 1,
      tieFallback: "higherBudget",
      noBidAction: "returnToPool",
      revealTopN: 1,
      earlyClose: false,
      brokeTeamsFillAtEnd: false,
    });
    expect(lines).toContain("Nominations go 1 → 12 every round.");
    expect(lines).toContain("Bids start at $5 in steps of $5; no one can bid past their budget or a position limit.");
    expect(lines).toContain("Ties: only the tied teams re-bid, each raising their own bid by at least $5, for up to 1 round.");
    expect(lines).toContain("If every tied team is all-in or the rounds run out, whoever has more money left decides.");
    expect(lines).toContain("If nobody bids, the player goes back in the pool.");
    expect(lines).toContain("The reveal shows only the winning bid.");
    expect(lines).toContain("Bidding always runs the full clock.");
    expect(lines).toContain("A team that goes broke before filling its auction spots leaves them empty.");
    expect(summarizeRules({ ...DEFAULT_SETTINGS, revealTopN: "all" })).toContain("The reveal shows every bid.");
  });
});
