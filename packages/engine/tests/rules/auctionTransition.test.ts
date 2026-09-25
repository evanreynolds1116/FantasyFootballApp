import { describe, it, expect } from "vitest";
import { makeCtx, makePlayerPool, makeState, nominateFullRound } from "../helpers.js";
import { applyAdminStart } from "../../src/rules/start.js";
import { applyNominate } from "../../src/rules/nomination.js";
import { applyBidSubmit } from "../../src/rules/bidding.js";
import { applyLotExpired } from "../../src/rules/reveal.js";
import { advanceAfterLotResolved } from "../../src/rules/auctionTransition.js";
import type { DraftState } from "../../src/model/types.js";

describe("auction -> snake transition", () => {
  it("transitions to snake once every team is full-or-broke exactly at a round boundary", () => {
    const players = makePlayerPool("QB", 10);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 1, rosterSize: 5 } });
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    let i = 0;
    state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);

    const lot1 = state.lots.find((l) => l.orderInRound === 1)!;
    state = applyLotExpired(state, { type: "clock:lotExpired", lotId: lot1.id }, ctx).state; // no-bid award to nominator
    const lot2 = state.lots.find((l) => l.orderInRound === 2)!;
    const res = applyLotExpired(state, { type: "clock:lotExpired", lotId: lot2.id }, ctx);

    expect(res.events).toContainEqual({ type: "draft:phase", phase: "snake" });
    expect(res.state.phase).toBe("snake");
    expect(res.state.nominationTurnTeamId).toBeNull();
  });

  it("auction ends mid-round: still-queued lots are cancelled and their players return to the pool", () => {
    // Construct a state directly where every team is already full-or-broke
    // and one lot is still "queued" (never opened), then confirm
    // advanceAfterLotResolved cancels it and transitions to snake.
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 1, rosterSize: 5 } });
    state = {
      ...state,
      phase: "auction",
      auctionRound: 1,
      picks: [
        { id: "p1", pickNo: 1, round: 1, teamId: "t1", playerId: "qb1", source: "auction", price: 5, madeAt: 0 },
        { id: "p2", pickNo: 2, round: 1, teamId: "t2", playerId: "qb2", source: "auction", price: 5, madeAt: 0 },
      ],
      lots: [
        {
          id: "lotQ",
          round: 1,
          orderInRound: 3,
          playerId: "qb3",
          nominatedByTeamId: "t1",
          state: "queued",
          tieRound: 0,
          endsAt: null,
          remainingMs: null,
          eligibleTeamIds: [],
          tiedTeamIds: [],
          winnerTeamId: null,
          price: null,
        },
      ],
    };
    const ctx = makeCtx(1000);
    const res = advanceAfterLotResolved(state, ctx);

    expect(res.events).toContainEqual({ type: "lot:cancelled", lotId: "lotQ", playerId: "qb3" });
    expect(res.events).toContainEqual({ type: "draft:phase", phase: "snake" });
    expect(res.state.lots.find((l) => l.id === "lotQ")?.state).toBe("cancelled");
  });

  it("an in-progress open lot always completes normally, even if its own completion is what fills the last team", () => {
    const players = makePlayerPool("QB", 5);
    let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 1, rosterSize: 5 } });
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    let i = 0;
    state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
    const lot1 = state.lots.find((l) => l.orderInRound === 1)!;
    state = applyBidSubmit(state, { type: "bid:submit", teamId: "t2", lotId: lot1.id, amount: 10 }, ctx).state;
    // This resolution fills t2's only spot AND, since t1 is already full-or-broke
    // depends on lot2's own resolution — but the point under test is that lot1
    // itself resolves to "awarded" cleanly regardless.
    const res = applyLotExpired(state, { type: "clock:lotExpired", lotId: lot1.id }, ctx);
    expect(res.state.lots.find((l) => l.id === lot1.id)?.state).toBe("awarded");
  });

  it("continues correctly with very few eligible teams left (2 of 4)", () => {
    const players = makePlayerPool("QB", 20);
    let state: DraftState = makeState({ teamCount: 4, players, settings: { auctionSpots: 1, rosterSize: 5 } });
    state = {
      ...state,
      picks: [
        { id: "p1", pickNo: 1, round: 0, teamId: "t1", playerId: "sink1", source: "auction", price: 5, madeAt: 0 },
        { id: "p2", pickNo: 2, round: 0, teamId: "t3", playerId: "sink2", source: "auction", price: 5, madeAt: 0 },
      ],
      players: [...players, { id: "sink1", name: "sink1", position: "QB" }, { id: "sink2", name: "sink2", position: "QB" }],
    };
    const ctx = makeCtx(1000);
    state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
    expect(state.nominationTurnTeamId).toBe("t2");
    let i = 0;
    state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
    expect(state.lots.filter((l) => l.round === 1)).toHaveLength(2);
    const lot1 = state.lots.find((l) => l.orderInRound === 1)!;
    const res = applyLotExpired(state, { type: "clock:lotExpired", lotId: lot1.id }, ctx);
    expect(res.events.some((e) => e.type === "draft:rejected")).toBe(false);
  });
});
