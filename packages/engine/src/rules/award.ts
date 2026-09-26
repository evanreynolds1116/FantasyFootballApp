import type { Ctx } from "../clock.js";
import { allocateId, bumpVersion } from "../model/state.js";
import type { DraftState, Lot, PickSource, PlayerId, TeamId } from "../model/types.js";
import type { Event } from "../events/types.js";
import type { ReduceResult } from "./result.js";

/** Next global pick number. Max + 1 rather than length + 1: the commissioner can remove a pick from the middle. */
export function nextPickNo(state: DraftState): number {
  return state.picks.reduce((max, p) => Math.max(max, p.pickNo), 0) + 1;
}

/** The one atomic update shared by auction awards, snake picks, makeup picks, and auto-picks. */
function makePick(
  state: DraftState,
  args: { teamId: TeamId; playerId: PlayerId; source: PickSource; price: number | null; round: number },
  ctx: Ctx,
) {
  const { id: pickId, state: withId } = allocateId(state, "pick");
  const pickNo = nextPickNo(withId);
  const pick = {
    id: pickId,
    pickNo,
    round: args.round,
    teamId: args.teamId,
    playerId: args.playerId,
    source: args.source,
    price: args.price,
    madeAt: ctx.now,
  };
  return { pick, state: bumpVersion({ ...withId, picks: [...withId.picks, pick], lastAwardOrPick: { kind: (args.source === "auction" ? "award" : "pick") as "award" | "pick", pickId } }) };
}

export function awardAuctionLot(state: DraftState, lot: Lot, winnerTeamId: TeamId, price: number, ctx: Ctx): ReduceResult {
  const { pick, state: withPick } = makePick(
    state,
    { teamId: winnerTeamId, playerId: lot.playerId, source: "auction", price, round: lot.round },
    ctx,
  );
  const updatedLot: Lot = { ...lot, state: "awarded", winnerTeamId, price };
  const nextState = {
    ...withPick,
    lots: withPick.lots.map((l) => (l.id === lot.id ? updatedLot : l)),
    lastAwardOrPick: { kind: "award" as const, lotId: lot.id, pickId: pick.id },
  };
  const events: Event[] = [
    { type: "lot:awarded", lotId: lot.id, teamId: winnerTeamId, playerId: lot.playerId, price },
    { type: "pick:made", teamId: winnerTeamId, playerId: lot.playerId, source: "auction", pickNo: pick.pickNo },
  ];
  return { state: nextState, events };
}

export function awardNonAuctionPick(
  state: DraftState,
  args: { teamId: TeamId; playerId: PlayerId; source: "snake" | "makeup" | "auto"; round: number },
  ctx: Ctx,
): ReduceResult {
  const { pick, state: nextState } = makePick(state, { ...args, price: null }, ctx);
  const events: Event[] = [
    { type: "pick:made", teamId: args.teamId, playerId: args.playerId, source: args.source, pickNo: pick.pickNo },
  ];
  return { state: nextState, events };
}
