import type { CommishEdit } from "@draft-app/engine";
import type { DraftSnapshot } from "../../lib/contracts";

/**
 * One commissioner edit in plain words, for the on-screen notice everyone
 * sees and the draft log, e.g. "Team 4's budget +$25 — Prize money carried
 * over" or "Keenan Owens added to Team 2 ($15)". Everything here is public;
 * there are never bid amounts in an edit.
 */
export function editText(edit: CommishEdit, snapshot: Pick<DraftSnapshot, "teams" | "players">): string {
  const team = (id: string) => `Team ${snapshot.teams.find((t) => t.id === id)?.draftNumber ?? "?"}`;
  const player = (id: string) => snapshot.players.find((p) => p.id === id)?.name ?? "A player";
  switch (edit.kind) {
    case "budget":
      return `${team(edit.teamId)}'s budget ${edit.amount > 0 ? "+" : "−"}$${Math.abs(edit.amount)} — ${edit.reason}`;
    case "remove":
      return `${player(edit.playerId)} taken off ${team(edit.teamId)}${edit.price !== null ? ` ($${edit.price} refunded)` : ""} and back in the pool`;
    case "assign":
      return `${player(edit.playerId)} added to ${team(edit.teamId)}${edit.price !== null ? ` ($${edit.price})` : " (snake spot)"}`;
    case "void":
      return `Lot voided — ${player(edit.playerId)} goes back in the pool, bids stay sealed`;
    case "unavailable":
      return `${player(edit.playerId)} marked unavailable`;
    case "available":
      return `${player(edit.playerId)} is available again`;
  }
}
