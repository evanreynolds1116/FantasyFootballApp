import { eligibleNominationOrderForRound, isPlayerAvailable, lotsInRound, type DraftState, type Lot, type Player, type Team } from "@draft-app/engine";

export type NominationSlot =
  | { kind: "nominated"; order: number; team: Team | undefined; lot: Lot; player: Player | undefined }
  | { kind: "onClock"; order: number; team: Team | undefined }
  | { kind: "upcoming"; order: number; team: Team | undefined };

/**
 * The current auction round's nominations, one slot per team that nominates
 * this round, in nomination order: who has already put a player up (and
 * which), who is on the clock, and who's still to come. Eligibility can't
 * change while a round's nominations are being collected (the engine's own
 * guarantee), so the order is stable for the whole round.
 */
export function nominationSlots(state: DraftState): NominationSlot[] {
  const round = state.auctionRound;
  const teamById = new Map(state.teams.map((t) => [t.id, t]));
  const playerById = new Map(state.players.map((p) => [p.id, p]));
  const lots = lotsInRound(state, round).slice().sort((a, b) => a.orderInRound - b.orderInRound);
  const order = eligibleNominationOrderForRound(state, round);

  const slots: NominationSlot[] = lots.map((lot, i) => ({ kind: "nominated", order: i + 1, team: teamById.get(lot.nominatedByTeamId), lot, player: playerById.get(lot.playerId) }));
  // Teams still to nominate, in order: the round's order minus the teams already in.
  const nominated = new Set(lots.map((l) => l.nominatedByTeamId));
  const remaining = order.filter((id) => !nominated.has(id));
  remaining.forEach((id, i) => {
    const kind = id === state.nominationTurnTeamId ? "onClock" : "upcoming";
    slots.push({ kind, order: lots.length + i + 1, team: teamById.get(id) });
  });
  return slots;
}

/**
 * Why a player isn't in the available list, in words — so searching for
 * someone already taken says so instead of just "no players match".
 * null when the player is available.
 */
export function unavailableReason(state: DraftState, playerId: string): string | null {
  if (isPlayerAvailable(state, playerId)) return null;
  const teamNumber = (id: string) => state.teams.find((t) => t.id === id)?.draftNumber ?? "?";

  const pick = state.picks.find((p) => p.playerId === playerId);
  if (pick) {
    const how = pick.source === "auction" ? `$${pick.price ?? 0}` : pick.source === "makeup" ? `make-up R${pick.round}` : `snake R${pick.round}`;
    return `Already drafted by Team ${teamNumber(pick.teamId)} (${how})`;
  }
  const lot = state.lots.find((l) => l.playerId === playerId && !["awarded", "returnedToPool", "cancelled"].includes(l.state));
  if (lot) {
    const where = lot.round === state.auctionRound ? "this round" : `in round ${lot.round}`;
    return `Already nominated ${where} — Lot ${lot.orderInRound}, by Team ${teamNumber(lot.nominatedByTeamId)}`;
  }
  if (state.unavailablePlayerIds.includes(playerId)) return "Marked unavailable by the commissioner";
  return "Not available";
}
