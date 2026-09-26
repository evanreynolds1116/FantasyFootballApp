import type { DraftSettings } from "./types.js";

/**
 * The league's default settings (CLAUDE.md: "Keep league defaults ... in one
 * settings default file"). 12 teams, $1,000 budget, 8 auction spots, 17-man
 * roster, $5 min bid, $5 tie raise, snake nominations.
 */
export const DEFAULT_SETTINGS: DraftSettings = {
  teamCount: 12,
  startingBudget: 1000,
  auctionSpots: 8,
  rosterSize: 17,
  positionGroups: [
    { name: "QB", positions: ["QB"], min: 2, max: 2 },
    { name: "RB", positions: ["RB"], min: 4, max: 5 },
    { name: "WR/TE", positions: ["WR", "TE"], min: 6, max: 7 },
    { name: "K", positions: ["K"], min: 2, max: 2 },
    { name: "DEF", positions: ["DEF"], min: 2, max: 2 },
  ],
  minBid: 5,
  bidStep: 1,
  tieMinRaise: 5,
  noBidAction: "awardNominator",
  nominationOrder: "snake",
  nominationClockSec: 30,
  bidClockSec: 60,
  tieClockSec: 30,
  pickClockSec: 60,
  earlyClose: true,
  maxTieRounds: null,
  tieFallback: "randomDraw",
  revealTopN: 3,
  pickExpiryAction: "autoPick",
  brokeTeamsFillAtEnd: true,
};
