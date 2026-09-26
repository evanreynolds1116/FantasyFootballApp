import { CLOCK_RANGES_SEC, type ClockName } from "./ranges.js";
import type { DraftSettings } from "./types.js";

export type SettingsIssue = { field: keyof DraftSettings; message: string };

const TIE_FALLBACKS = ["randomDraw", "commissionerDecides", "higherBudget", "earlierTeamNumber"];
const NO_BID_ACTIONS = ["awardNominator", "returnToPool"];
const NOMINATION_ORDERS = ["snake", "fixed"];
const PICK_EXPIRY_ACTIONS = ["autoPick", "skip"];

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

/**
 * Checks a full settings object against SPEC.md's league settings table
 * ("Allowed range / options") plus the cross-field rules that make a draft
 * runnable at all. Returns every problem found (empty = valid) so a form can
 * show them all at once. Checks runtime types too — the server runs this on
 * request bodies that TypeScript never saw.
 */
export function validateSettings(s: DraftSettings): SettingsIssue[] {
  const issues: SettingsIssue[] = [];
  const add = (field: keyof DraftSettings, message: string) => issues.push({ field, message });
  const intInRange = (field: keyof DraftSettings, label: string, min: number, max?: number) => {
    const v = s[field];
    if (!isInt(v) || v < min || (max !== undefined && v > max)) {
      add(field, max === undefined ? `${label} must be a whole number of at least ${min}.` : `${label} must be a whole number from ${min} to ${max}.`);
      return false;
    }
    return true;
  };

  intInRange("teamCount", "Number of teams", 2, 20);
  intInRange("startingBudget", "Starting budget", 1, 100_000);
  const rosterOk = intInRange("rosterSize", "Total roster size", 1, 30);
  if (rosterOk) intInRange("auctionSpots", "Auction roster spots", 0, s.rosterSize);
  else intInRange("auctionSpots", "Auction roster spots", 0);
  intInRange("minBid", "Minimum bid", 0);
  intInRange("bidStep", "Bid step", 1);
  intInRange("tieMinRaise", "Minimum tie raise", 1);

  const clockFields: [keyof DraftSettings, ClockName, string][] = [
    ["nominationClockSec", "nomination", "Nomination clock"],
    ["bidClockSec", "bid", "Bid clock"],
    ["tieClockSec", "tie", "Tie re-bid clock"],
    ["pickClockSec", "pick", "Snake pick clock"],
  ];
  for (const [field, clock, label] of clockFields) {
    const v = s[field];
    const { min, max } = CLOCK_RANGES_SEC[clock];
    if (v !== "off" && (!isInt(v) || v < min || v > max)) add(field, `${label} must be off or ${min}–${max} seconds.`);
  }

  if (s.maxTieRounds !== null && (!isInt(s.maxTieRounds) || s.maxTieRounds < 1 || s.maxTieRounds > 10)) {
    add("maxTieRounds", "Max tie re-bid rounds must be unlimited or 1–10.");
  }
  // Capped at the max team count rather than this league's: "top 3" in a 2-team league just shows every bid, which is harmless.
  if (s.revealTopN !== "all" && (!isInt(s.revealTopN) || s.revealTopN < 1 || s.revealTopN > 20)) {
    add("revealTopN", "Bids shown at reveal must be all, or 1 (winner only) to 20.");
  }

  if (!TIE_FALLBACKS.includes(s.tieFallback)) add("tieFallback", "Unknown tie fallback.");
  if (!NO_BID_ACTIONS.includes(s.noBidAction)) add("noBidAction", "Unknown no-bid rule.");
  if (!NOMINATION_ORDERS.includes(s.nominationOrder)) add("nominationOrder", "Unknown nomination order.");
  if (!PICK_EXPIRY_ACTIONS.includes(s.pickExpiryAction)) add("pickExpiryAction", "Unknown pick-clock expiry rule.");
  for (const field of ["earlyClose", "brokeTeamsFillAtEnd"] as const) {
    if (typeof s[field] !== "boolean") add(field, `${field} must be on or off.`);
  }

  const groups = s.positionGroups;
  if (groups !== null) {
    if (!Array.isArray(groups) || groups.length === 0) {
      add("positionGroups", "Position limits must be off or list at least one group.");
    } else {
      const seenNames = new Set<string>();
      const seenPositions = new Set<string>();
      let minTotal = 0;
      for (const g of groups) {
        const name = typeof g?.name === "string" ? g.name.trim() : "";
        if (!name) {
          add("positionGroups", "Every position group needs a name.");
          continue;
        }
        if (seenNames.has(name)) add("positionGroups", `Two groups are both named ${name}.`);
        seenNames.add(name);
        if (!Array.isArray(g.positions) || g.positions.length === 0 || g.positions.some((p) => typeof p !== "string" || !p.trim())) {
          add("positionGroups", `${name} needs at least one position.`);
        } else {
          for (const p of g.positions) {
            if (seenPositions.has(p)) add("positionGroups", `${p} is in more than one group.`);
            seenPositions.add(p);
          }
        }
        if (!isInt(g.min) || !isInt(g.max) || g.min < 0 || g.max < g.min) {
          add("positionGroups", `${name} needs whole-number limits with 0 ≤ min ≤ max.`);
        } else {
          minTotal += g.min;
        }
      }
      if (rosterOk && minTotal > s.rosterSize) {
        add("positionGroups", `The position minimums add up to ${minTotal}, more than the ${s.rosterSize}-player roster.`);
      }
    }
  }

  return issues;
}
