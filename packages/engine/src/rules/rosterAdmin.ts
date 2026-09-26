import type { Action } from "../actions/types.js";
import type { Ctx } from "../clock.js";
import { allocateId, bumpVersion } from "../model/state.js";
import type { CommishEdit, DraftState, Lot, Pick, TeamId } from "../model/types.js";
import { remainingBudget } from "../selectors/budget.js";
import { eligibleTeamIdsForPlayer } from "../selectors/eligibility.js";
import { currentLot, isPlayerAvailable } from "../selectors/lots.js";
import { wouldExceedPositionMax } from "../selectors/roster.js";
import { openRosterSlots } from "../selectors/slots.js";
import type { Event } from "../events/types.js";
import { nextPickNo } from "./award.js";
import { reject, type ReduceResult } from "./result.js";

/** Largest single budget adjustment, either way — a guard against a typo like 10000 for 100. */
export const MAX_BUDGET_ADJUSTMENT = 100_000;

/** Appends a commissioner edit with a fresh id and returns the matching event. */
export function logEdit(state: DraftState, edit: DistributiveOmit<CommishEdit, "id" | "at">, ctx: Ctx): { state: DraftState; event: Event } {
  const { id, state: withId } = allocateId(state, "edit");
  const entry = { ...edit, id, at: ctx.now } as CommishEdit;
  return { state: { ...withId, commishLog: [...withId.commishLog, entry] }, event: { type: "commish:edit", edit: entry } };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Whether the team has a bid (or pass) in on the lot being decided right now.
 * Edits that take money or a spot away wait until that lot is decided, so a
 * sealed bid can never end up over budget. That a team has bid is already
 * public (the bid-status strip), so refusing reveals nothing new.
 */
function hasLiveBid(state: DraftState, teamId: TeamId): boolean {
  const lot = currentLot(state);
  if (!lot || (lot.state !== "open" && lot.state !== "tieRebid")) return false;
  return state.bids.some((b) => b.lotId === lot.id && b.teamId === teamId && !b.superseded);
}

/** After an edit gives a team money or a spot back, it may now be able to bid on the open lot. Only ever widens, like undo. */
function widenOpenLotEligibility(state: DraftState): DraftState {
  const live = currentLot(state);
  if (!live || live.state !== "open") return state;
  const widened = new Set([...live.eligibleTeamIds, ...eligibleTeamIdsForPlayer(state, live.playerId)]);
  const refreshed: Lot = { ...live, eligibleTeamIds: state.teams.map((t) => t.id).filter((id) => widened.has(id)) };
  return { ...state, lots: state.lots.map((l) => (l.id === live.id ? refreshed : l)) };
}

/**
 * The undo target, ignoring commissioner-added players — undo is for the
 * last award or pick made in the draft itself.
 */
function lastDraftedPick(state: DraftState, picks: Pick[]): DraftState["lastAwardOrPick"] {
  const assigned = new Set(state.commishLog.flatMap((e) => (e.kind === "assign" ? [e.pickId] : [])));
  const last = [...picks].reverse().find((p) => !assigned.has(p.id));
  if (!last) return null;
  if (last.source === "auction") {
    const lot = state.lots.find((l) => l.playerId === last.playerId && l.state === "awarded" && l.winnerTeamId === last.teamId);
    return { kind: "award", lotId: lot?.id, pickId: last.id };
  }
  return { kind: "pick", pickId: last.id };
}

function rosterEditsBlocked(state: DraftState): string | null {
  if (state.phase === "setup") return "The draft hasn't started.";
  // Make-up turn order is worked out from who still owes a pick, so changing rosters mid-round could skip or repeat a turn.
  if (state.phase === "makeup") return "Rosters can't be edited during the make-up round. Wait until it's complete.";
  return null;
}

export function applyAdjustBudget(state: DraftState, action: Extract<Action, { type: "admin:adjustBudget" }>, ctx: Ctx): ReduceResult {
  if (state.phase === "setup") return reject(state, action, "INVALID_PHASE", "The draft hasn't started.");
  if (!state.teams.some((t) => t.id === action.teamId)) return reject(state, action, "INVALID_EDIT", "Unknown team.");
  if (!Number.isInteger(action.amount) || action.amount === 0 || Math.abs(action.amount) > MAX_BUDGET_ADJUSTMENT) {
    return reject(state, action, "INVALID_EDIT", "Enter a whole-dollar amount other than $0.");
  }
  const reason = action.reason.trim();
  if (!reason) return reject(state, action, "INVALID_EDIT", "Give a reason — everyone sees it in the draft log.");
  if (action.amount < 0) {
    if (remainingBudget(state, action.teamId) + action.amount < 0) {
      return reject(state, action, "OVER_BUDGET", `That would leave the team below $0 (it has $${remainingBudget(state, action.teamId)}).`);
    }
    if (hasLiveBid(state, action.teamId)) {
      return reject(state, action, "BID_IN_PROGRESS", "This team has a bid in on the current lot. Take money away after it's decided.");
    }
  }
  const logged = logEdit(state, { kind: "budget", teamId: action.teamId, amount: action.amount, reason: reason.slice(0, 200) }, ctx);
  const next = action.amount > 0 ? widenOpenLotEligibility(logged.state) : logged.state;
  return { state: bumpVersion(next), events: [logged.event] };
}

export function applyRemovePick(state: DraftState, action: Extract<Action, { type: "admin:removePick" }>, ctx: Ctx): ReduceResult {
  const blocked = rosterEditsBlocked(state);
  if (blocked) return reject(state, action, "INVALID_PHASE", blocked);
  const pick = state.picks.find((p) => p.id === action.pickId);
  if (!pick) return reject(state, action, "INVALID_EDIT", "That player isn't on a roster.");

  const picks = state.picks.filter((p) => p.id !== pick.id);
  let next: DraftState = { ...state, picks };
  // Like undo: the lot it came from ends as returned-to-pool, so the player can be nominated again.
  if (pick.source === "auction") {
    next = {
      ...next,
      lots: next.lots.map((l) =>
        l.playerId === pick.playerId && l.state === "awarded" && l.winnerTeamId === pick.teamId ? { ...l, state: "returnedToPool", winnerTeamId: null, price: null } : l,
      ),
    };
  }
  if (state.lastAwardOrPick?.pickId === pick.id) next = { ...next, lastAwardOrPick: lastDraftedPick(next, picks) };

  const logged = logEdit(next, { kind: "remove", teamId: pick.teamId, playerId: pick.playerId, pickId: pick.id, source: pick.source, price: pick.price }, ctx);
  return { state: bumpVersion(widenOpenLotEligibility(logged.state)), events: [logged.event] };
}

export function applyAssignPlayer(state: DraftState, action: Extract<Action, { type: "admin:assignPlayer" }>, ctx: Ctx): ReduceResult {
  const blocked = rosterEditsBlocked(state);
  if (blocked) return reject(state, action, "INVALID_PHASE", blocked);
  if (!state.teams.some((t) => t.id === action.teamId)) return reject(state, action, "INVALID_EDIT", "Unknown team.");
  if (!isPlayerAvailable(state, action.playerId)) return reject(state, action, "PLAYER_TAKEN", "That player isn't available.");
  const player = state.players.find((p) => p.id === action.playerId);
  if (player && wouldExceedPositionMax(state, action.teamId, player.position)) {
    return reject(state, action, "POSITION_LIMIT", "The team is already at the maximum for this position.");
  }

  const open = openRosterSlots(state, action.teamId);
  let price: number | null = null;
  if (action.slot === "auction") {
    if (open.auction <= 0) return reject(state, action, "ROSTER_FULL", "The team has no open auction spot.");
    price = action.price ?? -1;
    if (!Number.isInteger(price) || price < 0) return reject(state, action, "INVALID_EDIT", "Enter the price paid ($0 or more).");
    if (price > remainingBudget(state, action.teamId)) {
      return reject(state, action, "OVER_BUDGET", `The team only has $${remainingBudget(state, action.teamId)} left.`);
    }
    if (hasLiveBid(state, action.teamId)) {
      return reject(state, action, "BID_IN_PROGRESS", "This team has a bid in on the current lot. Add the player after it's decided.");
    }
  } else if (open.snake <= 0) {
    return reject(state, action, "ROSTER_FULL", "The team has no open snake spot — its remaining snake turns will fill its roster.");
  }

  const { id: pickId, state: withId } = allocateId(state, "pick");
  const pick: Pick = {
    id: pickId,
    pickNo: nextPickNo(withId),
    round: 0,
    teamId: action.teamId,
    playerId: action.playerId,
    source: action.slot === "auction" ? "auction" : "snake",
    price,
    madeAt: ctx.now,
  };
  const logged = logEdit({ ...withId, picks: [...withId.picks, pick] }, { kind: "assign", teamId: action.teamId, playerId: action.playerId, pickId, slot: action.slot, price }, ctx);
  return { state: bumpVersion(logged.state), events: [logged.event] };
}
