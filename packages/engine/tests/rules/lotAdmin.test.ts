import { describe, it, expect } from "vitest";
import { makeCtx, makePlayerPool, makeState, nominateFullRound } from "../helpers.js";
import { applyAdminStart } from "../../src/rules/start.js";
import { applyNominate } from "../../src/rules/nomination.js";
import { applyVoidLot, applyMarkPlayerUnavailable } from "../../src/rules/lotAdmin.js";
import type { DraftState } from "../../src/model/types.js";

function openLotFixture() {
  const players = makePlayerPool("QB", 10);
  let state: DraftState = makeState({ teamCount: 2, players, settings: { auctionSpots: 8, rosterSize: 17 } });
  const ctx = makeCtx(1000);
  state = applyAdminStart(state, { type: "admin:start" }, ctx).state;
  let i = 0;
  state = nominateFullRound(state, ctx, () => players[i++]!.id, applyNominate);
  return { state, ctx, lot: state.lots[0]!, players };
}

describe("lot admin (late injury / void lot)", () => {
  it("voids an open lot: it's cancelled and the player returns to the pool", () => {
    const { state, ctx, lot } = openLotFixture();
    const res = applyVoidLot(state, { type: "admin:voidLot", lotId: lot.id }, ctx);
    expect(res.events).toContainEqual({ type: "lot:cancelled", lotId: lot.id, playerId: lot.playerId });
    expect(res.state.lots.find((l) => l.id === lot.id)?.state).toBe("cancelled");
  });

  it("rejects voiding a lot that isn't open", () => {
    const { state, ctx, lot } = openLotFixture();
    const voided = applyVoidLot(state, { type: "admin:voidLot", lotId: lot.id }, ctx).state;
    const res = applyVoidLot(voided, { type: "admin:voidLot", lotId: lot.id }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "LOT_CLOSED" });
  });

  it("marks an available player unavailable, removing them from the pool", () => {
    const { state, ctx } = openLotFixture();
    const unpickedPlayerId = "qb9";
    const res = applyMarkPlayerUnavailable(state, { type: "admin:markPlayerUnavailable", playerId: unpickedPlayerId }, ctx);
    expect(res.events).toContainEqual({ type: "player:unavailable", playerId: unpickedPlayerId });
    expect(res.state.unavailablePlayerIds).toContain(unpickedPlayerId);
  });

  it("rejects marking a player unavailable if they're already picked or in an open lot", () => {
    const { state, ctx, lot } = openLotFixture();
    const res = applyMarkPlayerUnavailable(state, { type: "admin:markPlayerUnavailable", playerId: lot.playerId }, ctx);
    expect(res.events[0]).toMatchObject({ type: "draft:rejected", code: "PLAYER_TAKEN" });
  });
});
