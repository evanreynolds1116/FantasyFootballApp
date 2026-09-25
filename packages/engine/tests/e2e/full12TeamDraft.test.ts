import { describe, it, expect } from "vitest";
import { makeCtx, makeTeams } from "../helpers.js";
import { reduce } from "../../src/reduce.js";
import { createInitialState } from "../../src/model/state.js";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults.js";
import { availablePlayerIds, isPlayerAvailable } from "../../src/selectors/lots.js";
import { auctionSpotsRemaining, isBroke, remainingBudget, spentByTeam } from "../../src/selectors/budget.js";
import { groupsBelowMinimum, rosterSpotsRemaining, wouldExceedPositionMax } from "../../src/selectors/roster.js";
import { lotsInRound } from "../../src/selectors/lots.js";
import type { Action } from "../../src/actions/types.js";
import type { DraftState, Player } from "../../src/model/types.js";
import type { Event } from "../../src/events/types.js";

function buildPool(): Player[] {
  const make = (prefix: string, position: string, count: number): Player[] =>
    Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i + 1}`, name: `${prefix}${i + 1}`, position }));
  // Concatenated (not interleaved) so every team's greedy "fill what's below
  // minimum first" nomination strategy naturally saturates QB (min 2) first,
  // then RB (min 4), then WR/TE (min 6), then K and DEF — a realistic,
  // deterministic progression toward each team's valid 17-man roster.
  return [
    ...make("qb", "QB", 30),
    ...make("rb", "RB", 80),
    ...make("wr", "WR", 60),
    ...make("te", "TE", 50),
    ...make("k", "K", 30),
    ...make("def", "DEF", 30),
  ];
}

/** Greedily nominates whatever position this team still needs most, preferring the first available such player. */
function chooseNominee(state: DraftState, teamId: string): string {
  const needed = new Set(groupsBelowMinimum(state, teamId).flatMap((g) => g.positions));
  const playerById = new Map(state.players.map((p) => [p.id, p]));
  const available = availablePlayerIds(state);
  for (const id of available) {
    const p = playerById.get(id);
    if (p && needed.has(p.position) && !wouldExceedPositionMax(state, teamId, p.position)) return id;
  }
  for (const id of available) {
    const p = playerById.get(id);
    if (p && !wouldExceedPositionMax(state, teamId, p.position)) return id;
  }
  return available[0] as string;
}

describe("full 12-team scripted draft (league defaults)", () => {
  it("replays correctly end to end, exercising every required mechanic", () => {
    const players = buildPool();
    const teams = makeTeams(12);
    let state: DraftState = createInitialState(DEFAULT_SETTINGS, teams, players);
    const ctx = makeCtx(1_700_000_000_000);
    const allEvents: Event[] = [];

    const drive = (action: Action) => {
      const res = reduce(state, action, ctx);
      expect(res.events[0], `unexpected rejection for ${action.type}`).not.toMatchObject({ type: "draft:rejected" });
      state = res.state;
      allEvents.push(...res.events);
      return res;
    };
    const driveAllowingRejection = (action: Action) => {
      const res = reduce(state, action, ctx);
      state = res.state;
      allEvents.push(...res.events);
      return res;
    };

    // --- Start the draft ---
    drive({ type: "admin:start" });
    expect(state.phase).toBe("auction");

    // === 1. A tie resolving in 2+ rebid rounds, won by the nominator itself
    //     (keeps every team's spot-count pace in sync: t1 still "earns" a
    //     spot this round, just at a much higher price). ===
    let tieDone = false;
    // === Requirement: a team (t7) goes broke before filling all 8 auction
    //     spots, by winning its own first 4 nominations at $250 each. ===
    let t7WinCount = 0;
    // === Requirement: a no-bid return-to-pool, later re-nominated and
    //     drafted by a different team. ===
    let fullNominatorScriptDone = false;
    let returnedPlayerId: string | null = null;
    let renominatedPlayerId: string | null = null;
    let renominatedByTeamId: string | null = null;
    let originalReturnedNominator: string | null = null;
    // === Requirement: at least one bid rejected for a maxed position
    //     (NOT_ELIGIBLE, since auction eligibility is pre-screened — see
    //     bidding.ts), plus a nomination of a player at a maxed position
    //     (allowed). ===
    let positionLimitNominationDone = false;
    let positionLimitBidRejectionDone = false;

    let guard = 0;
    while (state.phase === "auction") {
      guard += 1;
      expect(guard).toBeLessThan(500);

      if (state.nominationTurnTeamId) {
        const teamId = state.nominationTurnTeamId;

        if (teamId === "t5" && !positionLimitNominationDone && groupsBelowMinimum(state, "t5").every((g) => g.name !== "QB")) {
          // t5 has already satisfied its QB minimum (2) but nominates a 3rd
          // QB anyway — nomination never checks position max.
          const qbId = availablePlayerIds(state).find((id) => state.players.find((p) => p.id === id)?.position === "QB");
          if (qbId) {
            drive({ type: "nominate", teamId, playerId: qbId });
            positionLimitNominationDone = true;
            continue;
          }
        }

        if (fullNominatorScriptDone && returnedPlayerId && isPlayerAvailable(state, returnedPlayerId) && !wouldExceedPositionMax(state, teamId, players.find((p) => p.id === returnedPlayerId)!.position)) {
          drive({ type: "nominate", teamId, playerId: returnedPlayerId });
          renominatedPlayerId = returnedPlayerId;
          renominatedByTeamId = teamId;
          returnedPlayerId = null; // only redirect once
          continue;
        }

        drive({ type: "nominate", teamId, playerId: chooseNominee(state, teamId) });
        continue;
      }

      const lot = state.lots.find((l) => l.state === "open");
      if (!lot) break;

      // --- Scripted: the tie, on t1's very first nomination. ---
      if (!tieDone && lot.round === 1 && lot.nominatedByTeamId === "t1") {
        drive({ type: "bid:submit", teamId: "t1", lotId: lot.id, amount: 100 });
        drive({ type: "bid:submit", teamId: "t2", lotId: lot.id, amount: 100 });
        drive({ type: "clock:lotExpired", lotId: lot.id });
        expect(state.lots.find((l) => l.id === lot.id)?.state).toBe("tieRebid");
        drive({ type: "tie:rebid", teamId: "t1", lotId: lot.id, amount: 150 });
        drive({ type: "tie:rebid", teamId: "t2", lotId: lot.id, amount: 150 });
        expect(state.lots.find((l) => l.id === lot.id)?.tieRound).toBe(2);
        drive({ type: "tie:rebid", teamId: "t1", lotId: lot.id, amount: 200 });
        const res = drive({ type: "tie:rebid", teamId: "t2", lotId: lot.id, amount: 180 });
        expect(res.events).toContainEqual({ type: "lot:awarded", lotId: lot.id, teamId: "t1", playerId: lot.playerId, price: 200 });
        tieDone = true;
        continue;
      }

      // --- Scripted: t7 wins its own first 4 nominations at $250 each, going broke. ---
      if (lot.nominatedByTeamId === "t7" && t7WinCount < 4) {
        drive({ type: "bid:submit", teamId: "t7", lotId: lot.id, amount: 250 });
        drive({ type: "clock:lotExpired", lotId: lot.id });
        t7WinCount += 1;
        continue;
      }

      // --- Scripted: a bid attempt from a position-maxed team, rejected NOT_ELIGIBLE. ---
      if (positionLimitNominationDone && !positionLimitBidRejectionDone) {
        const player = players.find((p) => p.id === lot.playerId)!;
        if (player.position === "QB" && wouldExceedPositionMax(state, "t3", "QB")) {
          const res = driveAllowingRejection({ type: "bid:submit", teamId: "t3", lotId: lot.id, amount: 10 });
          expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "NOT_ELIGIBLE" });
          positionLimitBidRejectionDone = true;
        }
      }

      // --- Scripted: the "nominator already full" -> return-to-pool case,
      //     triggered the first time a round's last nominator has exactly
      //     one auction spot left: that team wins the round's first lot
      //     instead of its rightful nominator, so it's already full once
      //     its own (last) lot in this round opens. ---
      if (!fullNominatorScriptDone && lot.orderInRound === 1) {
        const roundLots = lotsInRound(state, lot.round);
        if (roundLots.length > 1) {
          const lastLot = [...roundLots].sort((a, b) => b.orderInRound - a.orderInRound)[0]!;
          const targetTeam = lastLot.nominatedByTeamId;
          if (
            targetTeam !== lot.nominatedByTeamId &&
            auctionSpotsRemaining(state, targetTeam) === 1 &&
            lot.eligibleTeamIds.includes(targetTeam)
          ) {
            drive({ type: "bid:submit", teamId: targetTeam, lotId: lot.id, amount: 5 });
            const res = drive({ type: "clock:lotExpired", lotId: lot.id });
            expect(res.events).toContainEqual(expect.objectContaining({ type: "lot:awarded", teamId: targetTeam }));
            fullNominatorScriptDone = true;
            continue;
          }
        }
      }

      // --- Detect the return-to-pool once it happens, for later re-nomination tracking. ---
      if (fullNominatorScriptDone && returnedPlayerId === null && renominatedPlayerId === null) {
        const nominatorFull = auctionSpotsRemaining(state, lot.nominatedByTeamId) === 0;
        if (nominatorFull) {
          const res = drive({ type: "clock:lotExpired", lotId: lot.id });
          const returned = res.events.find((e) => e.type === "lot:returned");
          if (returned && returned.type === "lot:returned") {
            returnedPlayerId = returned.playerId;
            originalReturnedNominator = lot.nominatedByTeamId;
          }
          continue;
        }
      }

      // --- Default: nobody bids, resolved via no-bid to the nominator at minBid. ---
      drive({ type: "clock:lotExpired", lotId: lot.id });
    }

    expect(tieDone).toBe(true);
    expect(t7WinCount).toBe(4);
    expect(fullNominatorScriptDone).toBe(true);
    expect(positionLimitNominationDone).toBe(true);
    expect(positionLimitBidRejectionDone).toBe(true);

    // t7 is broke: spent exactly $1000 across 4 lots, well below minBid, with spots left.
    expect(spentByTeam(state, "t7")).toBe(1000);
    expect(remainingBudget(state, "t7")).toBe(0);
    expect(isBroke(state, "t7")).toBe(true);
    expect(auctionSpotsRemaining(state, "t7")).toBe(4);

    // Every other team finished the auction full (8/8), t7 alone is short.
    for (const team of teams) {
      const remaining = auctionSpotsRemaining(state, team.id);
      if (team.id === "t7") expect(remaining).toBe(4);
      else expect(remaining).toBe(0);
    }

    // === Auction -> snake transition ===
    expect(allEvents.some((e) => e.type === "draft:phase" && e.phase === "snake")).toBe(true);
    expect(state.phase === "snake" || state.phase === "makeup").toBe(true);

    // Budget checkpoint #1: right after the auction, derived budgets match manual sums.
    for (const team of teams) {
      const manualSpend = state.picks.filter((p) => p.teamId === team.id && p.price !== null).reduce((s, p) => s + (p.price as number), 0);
      expect(spentByTeam(state, team.id)).toBe(manualSpend);
      expect(remainingBudget(state, team.id)).toBe(DEFAULT_SETTINGS.startingBudget - manualSpend);
    }

    // === 2. Full snake phase (delegated to the engine's own auto-pick, which
    //     already enforces position max and remaining-minimum reachability
    //     on every single pick — this exercises that logic ~100 times). ===
    // First, deliberately probe a remaining-minimum-constrained rejection on
    // whichever team is on the clock once its roster gets tight.
    let minimumConstraintProbed = false;
    guard = 0;
    while (state.phase === "snake") {
      guard += 1;
      expect(guard).toBeLessThan(2000);
      const teamId = state.snakePickTurnTeamId!;

      if (!minimumConstraintProbed && rosterSpotsRemaining(state, teamId) > 0 && rosterSpotsRemaining(state, teamId) <= groupsBelowMinimum(state, teamId).length) {
        const neededPositions = new Set(groupsBelowMinimum(state, teamId).flatMap((g) => g.positions));
        const invalidCandidate = availablePlayerIds(state)
          .map((id) => players.find((p) => p.id === id)!)
          .find((p) => !neededPositions.has(p.position) && !wouldExceedPositionMax(state, teamId, p.position));
        if (invalidCandidate) {
          const res = driveAllowingRejection({ type: "pick:make", teamId, playerId: invalidCandidate.id });
          expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "POSITION_LIMIT" });
          minimumConstraintProbed = true;
        }
      }

      drive({ type: "clock:pickExpired", teamId });
    }

    expect(minimumConstraintProbed).toBe(true);

    // === 3. Broke-team make-up rounds (t7 owes its 4 missing auction spots). ===
    expect(state.phase === "makeup" || state.phase === "complete").toBe(true);
    if (state.phase === "makeup") {
      expect(allEvents.some((e) => e.type === "draft:phase" && e.phase === "makeup")).toBe(true);
      guard = 0;
      while (state.phase === "makeup") {
        guard += 1;
        expect(guard).toBeLessThan(200);
        const teamId = state.snakePickTurnTeamId!;
        expect(teamId).toBe("t7"); // t7 is the only broke team
        drive({ type: "clock:pickExpired", teamId });
      }
    }

    // === Draft complete: every roster is exactly rosterSize (17). ===
    expect(state.phase).toBe("complete");
    expect(allEvents.some((e) => e.type === "draft:phase" && e.phase === "complete")).toBe(true);
    for (const team of teams) {
      const rosterCount = state.picks.filter((p) => p.teamId === team.id).length;
      expect(rosterCount).toBe(DEFAULT_SETTINGS.rosterSize);
    }

    // Every player on every roster satisfies position group bounds.
    for (const team of teams) {
      expect(groupsBelowMinimum(state, team.id)).toEqual([]);
      for (const group of DEFAULT_SETTINGS.positionGroups!) {
        const count = state.picks.filter((p) => p.teamId === team.id && players.find((pl) => pl.id === p.playerId && group.positions.includes(pl.position))).length;
        expect(count).toBeGreaterThanOrEqual(group.min);
        expect(count).toBeLessThanOrEqual(group.max);
      }
    }

    // Budget checkpoint #2 (final): derived budgets match manual sums for every team.
    for (const team of teams) {
      const manualSpend = state.picks.filter((p) => p.teamId === team.id && p.price !== null).reduce((s, p) => s + (p.price as number), 0);
      expect(spentByTeam(state, team.id)).toBe(manualSpend);
    }
    // t7's budget never changed after going broke (no further money spent).
    expect(spentByTeam(state, "t7")).toBe(1000);

    // No player is drafted twice; every roster slot maps to a unique player.
    const allDraftedPlayerIds = state.picks.map((p) => p.playerId);
    expect(new Set(allDraftedPlayerIds).size).toBe(allDraftedPlayerIds.length);

    // The originally-returned player was re-nominated and drafted, by a
    // team other than its original nominator whose award attempt failed.
    expect(renominatedPlayerId).not.toBeNull();
    const finalPickForReturnedPlayer = state.picks.find((p) => p.playerId === renominatedPlayerId);
    expect(finalPickForReturnedPlayer).toBeDefined();
    expect(finalPickForReturnedPlayer?.teamId).toBe(renominatedByTeamId);
    expect(finalPickForReturnedPlayer?.teamId).not.toBe(originalReturnedNominator);

    // === Bid secrecy invariant across the entire scripted draft. ===
    const publicEvents = allEvents.filter((e) => e.type !== "lot:reveal" && e.type !== "lot:tieRebidRevealed" && e.type !== "draft:rejected");
    const scanForAmount = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(scanForAmount);
      if (value && typeof value === "object") {
        for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
          if (key === "amount") return true;
          if (scanForAmount(v)) return true;
        }
      }
      return false;
    };
    for (const event of publicEvents) {
      expect(scanForAmount(event), `event ${event.type} leaked an amount`).toBe(false);
    }
  });
});
