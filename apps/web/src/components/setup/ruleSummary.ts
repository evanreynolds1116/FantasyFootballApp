import type { ClockSetting, DraftSettings } from "@draft-app/engine";

const money = (n: number) => `$${n.toLocaleString("en-US")}`;
const clock = (c: ClockSetting) => (c === "off" ? "off" : `${c} s`);
const range = (min: number, max: number) => (min === max ? `${min}` : `${min}–${max}`);
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const countWord = (n: number) => NUMBER_WORDS[n] ?? String(n);

/**
 * The setup screen's "rule summary preview" (SPEC screens table): the
 * settings read back as plain sentences, so the commissioner can check them
 * the way the league would describe its own rules.
 */
export function summarizeRules(s: DraftSettings): string[] {
  const lines: string[] = [];
  const snakeSpots = s.rosterSize - s.auctionSpots;

  lines.push(
    s.auctionSpots === 0
      ? `${s.teamCount} teams, straight snake draft for a ${s.rosterSize}-player roster.`
      : snakeSpots === 0
        ? `${s.teamCount} teams with ${money(s.startingBudget)} each; all ${s.rosterSize} roster spots are bought at auction.`
        : `${s.teamCount} teams with ${money(s.startingBudget)} each buy ${s.auctionSpots} players at sealed-bid auction, then snake-draft ${snakeSpots} more for a ${s.rosterSize}-player roster.`,
  );

  lines.push(
    s.positionGroups === null
      ? "No position limits."
      : `Position limits: ${s.positionGroups.map((g) => `${g.name} ${range(g.min, g.max)}`).join(", ")}.`,
  );

  if (s.auctionSpots > 0) {
    lines.push(
      s.nominationOrder === "snake"
        ? `Nominations snake: 1 → ${s.teamCount}, then ${s.teamCount} → 1.`
        : `Nominations go 1 → ${s.teamCount} every round.`,
    );
    lines.push(`Bids start at ${money(s.minBid)}${s.bidStep > 1 ? ` in steps of ${money(s.bidStep)}` : ", any whole dollar"}; no one can bid past their budget or a position limit.`);
    lines.push(
      `Ties: only the tied teams re-bid, each raising their own bid by at least ${money(s.tieMinRaise)}` +
        (s.maxTieRounds === null ? ", for as many rounds as it takes." : `, for up to ${s.maxTieRounds} round${s.maxTieRounds === 1 ? "" : "s"}.`),
    );
    const fallback = {
      randomDraw: "a random draw",
      commissionerDecides: "the commissioner",
      higherBudget: "whoever has more money left",
      earlierTeamNumber: "the lower team number",
    }[s.tieFallback];
    lines.push(`If every tied team is all-in${s.maxTieRounds === null ? "" : " or the rounds run out"}, ${fallback} decides.`);
    lines.push(
      s.noBidAction === "awardNominator"
        ? `If nobody bids, the nominator gets the player for ${money(s.minBid)} (unless they're full, then the player goes back in the pool).`
        : "If nobody bids, the player goes back in the pool.",
    );
    lines.push(
      s.revealTopN === "all"
        ? "The reveal shows every bid."
        : s.revealTopN === 1
          ? "The reveal shows only the winning bid."
          : `The reveal shows the winner and the next ${countWord(s.revealTopN - 1)} bid${s.revealTopN === 2 ? "" : "s"}.`,
    );
    lines.push(s.earlyClose ? "Bidding closes early (3-second last call) once everyone has bid." : "Bidding always runs the full clock.");
    lines.push(
      s.brokeTeamsFillAtEnd
        ? `A team that can't afford ${money(s.minBid)} before filling its auction spots fills them with make-up picks after the snake.`
        : "A team that goes broke before filling its auction spots leaves them empty.",
    );
  }

  const clocks = s.auctionSpots > 0 ? `nominate ${clock(s.nominationClockSec)} · bid ${clock(s.bidClockSec)} · tie re-bid ${clock(s.tieClockSec)} · pick ${clock(s.pickClockSec)}` : `pick ${clock(s.pickClockSec)}`;
  lines.push(`Clocks: ${clocks}.`);
  // Make-up picks for broke teams run on the pick clock too, even with no regular snake rounds.
  if (snakeSpots > 0 || (s.auctionSpots > 0 && s.brokeTeamsFillAtEnd)) {
    lines.push(
      s.pickExpiryAction === "autoPick"
        ? "If the pick clock runs out, the app auto-picks the best available player that fits."
        : "If the pick clock runs out, that team is skipped and picks later.",
    );
  }
  return lines;
}
