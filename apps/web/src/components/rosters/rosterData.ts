import {
  auctionDesignatedSpotsRemaining,
  isBroke,
  maxBid,
  picksForTeam,
  positionGroupCount,
  remainingBudget,
  rosterCount,
  type Pick,
  type Player,
  type PositionGroup,
} from "@draft-app/engine";
import type { DraftSnapshot } from "../../lib/contracts";
import { asEngineState } from "../../store/selectors";

export type TeamSummary = {
  id: string;
  draftNumber: number;
  name: string;
  moneyLeft: number;
  maxBid: number;
  /** Designated auction spots still to fill — by winning a lot, or by a make-up pick for a broke team. */
  auctionSpotsLeft: number;
  rosterCount: number;
  broke: boolean;
  isMe: boolean;
};

/** One row per team, in draft order, straight from the engine's own budget/roster selectors. */
export function teamSummaries(snapshot: DraftSnapshot): TeamSummary[] {
  const state = asEngineState(snapshot);
  return [...snapshot.teams]
    .sort((a, b) => a.draftNumber - b.draftNumber)
    .map((team) => {
      const auctionSpotsLeft = auctionDesignatedSpotsRemaining(state, team.id);
      return {
        id: team.id,
        draftNumber: team.draftNumber,
        name: team.name,
        moneyLeft: remainingBudget(state, team.id),
        maxBid: maxBid(state, team.id),
        auctionSpotsLeft,
        rosterCount: rosterCount(state, team.id),
        // A broke team whose make-up picks have since filled its spots isn't "broke" any more in any sense a viewer cares about.
        broke: isBroke(state, team.id) && auctionSpotsLeft > 0,
        isMe: team.id === snapshot.myTeamId,
      };
    });
}

export type RosterEntry = { pick: Pick; player: Player | undefined };

export type RosterGroup = {
  /** null when the league has position limits off — one flat list. */
  group: PositionGroup | null;
  label: string;
  count: number;
  entries: RosterEntry[];
};

/**
 * A team's roster split by position group, in the league's group order.
 * Players whose position isn't in any group (shouldn't happen with a sane
 * pool, but the pool is commissioner-editable) land in a trailing "Other".
 */
export function rosterByGroup(snapshot: DraftSnapshot, teamId: string): RosterGroup[] {
  const state = asEngineState(snapshot);
  const playerById = new Map(snapshot.players.map((p) => [p.id, p]));
  const entries: RosterEntry[] = picksForTeam(state, teamId).map((pick) => ({ pick, player: playerById.get(pick.playerId) }));
  const groups = snapshot.settings.positionGroups;

  if (!groups) return [{ group: null, label: "Roster", count: entries.length, entries }];

  const result: RosterGroup[] = groups.map((group) => ({
    group,
    label: group.name,
    count: positionGroupCount(state, teamId, group),
    entries: entries.filter((e) => e.player !== undefined && group.positions.includes(e.player.position)),
  }));
  const other = entries.filter((e) => !groups.some((g) => e.player !== undefined && g.positions.includes(e.player.position)));
  if (other.length > 0) result.push({ group: null, label: "Other", count: other.length, entries: other });
  return result;
}

/** How a player got onto the roster, e.g. "$96", "Snake R3", "Make-up R1", "Auto-pick R4". */
export function acquiredLabel(pick: Pick): string {
  switch (pick.source) {
    case "auction":
      return `$${pick.price ?? 0}`;
    case "snake":
      // Round 0: put in an open snake spot by the commissioner, not drafted in a round.
      return pick.round === 0 ? "Added by commissioner" : `Snake R${pick.round}`;
    case "makeup":
      return `Make-up R${pick.round}`;
    case "auto":
      return `Auto-pick R${pick.round}`;
  }
}

/** "QB · 1 of 2", "RB · 5 of 4–5", "WR/TE · 7 of 6–7" — the group's count against its limits. */
export function groupLimitLabel(group: RosterGroup): string {
  if (!group.group) return `${group.count}`;
  const { min, max } = group.group;
  return `${group.count} of ${min === max ? min : `${min}–${max}`}`;
}
