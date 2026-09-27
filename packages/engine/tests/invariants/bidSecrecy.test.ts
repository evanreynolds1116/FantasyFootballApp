import { describe, it, expect } from "vitest";
import { makeCtx, makePlayerPool, makeState } from "../helpers.js";
import { reduce } from "../../src/reduce.js";
import { availablePlayerIds } from "../../src/selectors/lots.js";
import type { Event } from "../../src/events/types.js";
import type { DraftState } from "../../src/model/types.js";

/** Recursively scans a value for any key literally named "amount". */
function containsAmountKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsAmountKey);
  if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === "amount") return true;
      if (containsAmountKey(v)) return true;
    }
  }
  return false;
}

describe("bid secrecy invariant", () => {
  it("no event other than lot:reveal, lot:tieRebidRevealed, or a private draft:rejected ack ever carries a bid amount", () => {
    const players = makePlayerPool("QB", 10);
    let state: DraftState = makeState({
      teamCount: 4,
      players,
      settings: { auctionSpots: 2, rosterSize: 2, positionGroups: null, tieMinRaise: 5 },
    });
    const ctx = makeCtx(1000);
    const allEvents: Event[] = [];
    const drive = (action: Parameters<typeof reduce>[1]) => {
      // Like the managers, wait for any reveal to finish before the next move.
      if (state.revealHoldUntil !== null && ctx.now < state.revealHoldUntil) ctx.now = state.revealHoldUntil;
      const res = reduce(state, action, ctx);
      state = res.state;
      allEvents.push(...res.events);
    };

    drive({ type: "admin:start" });
    // Round 1: 4 nominations.
    drive({ type: "nominate", teamId: "t1", playerId: "qb1" });
    drive({ type: "nominate", teamId: "t2", playerId: "qb2" });
    drive({ type: "nominate", teamId: "t3", playerId: "qb3" });
    drive({ type: "nominate", teamId: "t4", playerId: "qb4" });

    const lot1 = state.lots[0]!;
    // A tie that goes to a rebid round, to exercise lot:tie / lot:tieRebidRevealed.
    drive({ type: "bid:submit", teamId: "t1", lotId: lot1.id, amount: 60 });
    drive({ type: "bid:submit", teamId: "t2", lotId: lot1.id, amount: 60 });
    drive({ type: "bid:submit", teamId: "t3", lotId: lot1.id, amount: 20 });
    drive({ type: "clock:lotExpired", lotId: lot1.id });
    drive({ type: "tie:rebid", teamId: "t1", lotId: lot1.id, amount: 70 });
    drive({ type: "tie:rebid", teamId: "t2", lotId: lot1.id, amount: 65 });

    // A rejected bid: this is the one documented exception — a private ack
    // that phase 2 must never broadcast — so it's excluded from the scan.
    const rejected = reduce(state, { type: "bid:submit", teamId: "t1", lotId: "not-a-real-lot", amount: 999 }, ctx);

    // Drive the rest of the auction to completion: nominate whenever it's
    // someone's turn, no-bid-close whenever a lot is open, across as many
    // further rounds as needed.
    for (let guard = 0; guard < 50 && state.phase === "auction"; guard += 1) {
      if (state.nominationTurnTeamId) {
        const teamId = state.nominationTurnTeamId;
        const playerId = availablePlayerIds(state)[0]!;
        drive({ type: "nominate", teamId, playerId });
        continue;
      }
      const openLot = state.lots.find((l) => l.state === "open");
      if (openLot) {
        drive({ type: "clock:lotExpired", lotId: openLot.id });
        continue;
      }
      break;
    }
    expect(state.phase).not.toBe("auction");

    const publicEvents = allEvents.filter((e) => e.type !== "lot:reveal" && e.type !== "lot:tieRebidRevealed" && e.type !== "draft:rejected");
    for (const event of publicEvents) {
      expect(containsAmountKey(event), `event ${event.type} unexpectedly carries an amount`).toBe(false);
    }

    // Sanity: the reveal/tie-reveal events actually did carry amounts (the
    // scan above isn't vacuously true), and the rejected private ack does
    // (documented as an intentional, non-broadcast exception).
    const revealEvents = allEvents.filter((e) => e.type === "lot:reveal" || e.type === "lot:tieRebidRevealed");
    expect(revealEvents.length).toBeGreaterThan(0);
    expect(revealEvents.some(containsAmountKey)).toBe(true);
    expect(containsAmountKey(rejected.events[0])).toBe(true);

    // lot:bidStatus never carries anything beyond {lotId, teamId, hasBid}.
    const bidStatusEvents = allEvents.filter((e) => e.type === "lot:bidStatus");
    expect(bidStatusEvents.length).toBeGreaterThan(0);
    for (const e of bidStatusEvents) {
      expect(Object.keys(e).sort()).toEqual(["hasBid", "lotId", "teamId", "type"]);
    }
  });
});
