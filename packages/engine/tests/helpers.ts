import { createInitialState } from "../src/model/state.js";
import { DEFAULT_SETTINGS } from "../src/settings/defaults.js";
import type { DraftSettings } from "../src/settings/types.js";
import type { DraftState, Player, Team } from "../src/model/types.js";
import type { Ctx } from "../src/clock.js";

export function makeTeams(count: number): Team[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `t${i + 1}`,
    draftNumber: i + 1,
    name: `Team ${i + 1}`,
  }));
}

export function makePlayers(specs: Array<{ id: string; position: string; name?: string }>): Player[] {
  return specs.map((s) => ({ id: s.id, name: s.name ?? s.id, position: s.position }));
}

/** A large-enough generic pool of a given position, useful for filling rosters/budgets in tests. */
export function makePlayerPool(position: string, count: number, prefix = position.toLowerCase()): Player[] {
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i + 1}`, name: `${prefix}${i + 1}`, position }));
}

export function makeState(opts: {
  teamCount?: number;
  teams?: Team[];
  players?: Player[];
  settings?: Partial<DraftSettings>;
}): DraftState {
  const teams = opts.teams ?? makeTeams(opts.teamCount ?? 2);
  const players = opts.players ?? [];
  const settings: DraftSettings = { ...DEFAULT_SETTINGS, ...opts.settings };
  return createInitialState(settings, teams, players);
}

/**
 * Walks nominate actions for every currently-eligible team in the current
 * round, in turn order, using `pickPlayerId` to choose each team's nominee.
 * Stops once the round's nominations are complete (nominationTurnTeamId
 * becomes null), which — for the currently-nominating round's lot 1 — also
 * opens it for bidding.
 */
export function nominateFullRound(
  state: DraftState,
  ctx: Ctx,
  pickPlayerId: (teamId: string, state: DraftState) => string,
  applyNominate: (state: DraftState, action: { type: "nominate"; teamId: string; playerId: string }, ctx: Ctx) => { state: DraftState; events: unknown[] },
): DraftState {
  let current = state;
  while (current.nominationTurnTeamId) {
    const teamId = current.nominationTurnTeamId;
    const playerId = pickPlayerId(teamId, current);
    current = applyNominate(current, { type: "nominate", teamId, playerId }, ctx).state;
  }
  return current;
}

/** A ctx with a fixed `now` and an rng that returns a fixed sequence (repeating the last value once exhausted). */
export function makeCtx(now: number, rngSequence: number[] = [0]): Ctx {
  let i = 0;
  return {
    now,
    rng: () => {
      const value = rngSequence[Math.min(i, rngSequence.length - 1)] as number;
      i += 1;
      return value;
    },
  };
}
