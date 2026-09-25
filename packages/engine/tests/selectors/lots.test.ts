import { describe, it, expect } from "vitest";
import { createInitialState } from "../../src/model/state.js";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults.js";
import { availablePlayerIds, currentLot, isPlayerAvailable } from "../../src/selectors/lots.js";
import type { DraftState, Lot, Pick, Player, Team } from "../../src/model/types.js";

const teams: Team[] = [{ id: "t1", draftNumber: 1, name: "Team 1" }];
const players: Player[] = [
  { id: "pl1", name: "P1", position: "QB" },
  { id: "pl2", name: "P2", position: "RB" },
  { id: "pl3", name: "P3", position: "WR" },
];

function baseLot(overrides: Partial<Lot>): Lot {
  return {
    id: "lot1",
    round: 1,
    orderInRound: 1,
    playerId: "pl1",
    nominatedByTeamId: "t1",
    state: "open",
    tieRound: 0,
    endsAt: null,
    remainingMs: null,
    eligibleTeamIds: ["t1"],
    tiedTeamIds: [],
    winnerTeamId: null,
    price: null,
    ...overrides,
  };
}

describe("lot selectors", () => {
  const base = createInitialState(DEFAULT_SETTINGS, teams, players);

  it("currentLot is the first non-terminal lot", () => {
    const state: DraftState = {
      ...base,
      lots: [
        baseLot({ id: "l1", playerId: "pl1", state: "awarded" }),
        baseLot({ id: "l2", playerId: "pl2", state: "open" }),
      ],
    };
    expect(currentLot(state)?.id).toBe("l2");
  });

  it("currentLot is undefined when every lot is terminal", () => {
    const state: DraftState = {
      ...base,
      lots: [baseLot({ id: "l1", state: "awarded" })],
    };
    expect(currentLot(state)).toBeUndefined();
  });

  it("a drafted player is unavailable", () => {
    const state: DraftState = {
      ...base,
      picks: [{ id: "p1", pickNo: 1, round: 1, teamId: "t1", playerId: "pl1", source: "auction", price: 5, madeAt: 0 } satisfies Pick],
    };
    expect(isPlayerAvailable(state, "pl1")).toBe(false);
  });

  it("a player currently in an open lot is unavailable (can't be double-nominated)", () => {
    const state: DraftState = { ...base, lots: [baseLot({ state: "open" })] };
    expect(isPlayerAvailable(state, "pl1")).toBe(false);
  });

  it("a player whose lot returned to pool is available again", () => {
    const state: DraftState = { ...base, lots: [baseLot({ state: "returnedToPool" })] };
    expect(isPlayerAvailable(state, "pl1")).toBe(true);
  });

  it("a player whose lot was cancelled is available again", () => {
    const state: DraftState = { ...base, lots: [baseLot({ state: "cancelled" })] };
    expect(isPlayerAvailable(state, "pl1")).toBe(true);
  });

  it("a player marked unavailable by the commissioner is excluded", () => {
    const state: DraftState = { ...base, unavailablePlayerIds: ["pl1"] };
    expect(isPlayerAvailable(state, "pl1")).toBe(false);
  });

  it("availablePlayerIds reflects all the above at once", () => {
    const state: DraftState = {
      ...base,
      lots: [baseLot({ id: "l1", playerId: "pl2", state: "open" })],
      picks: [{ id: "p1", pickNo: 1, round: 1, teamId: "t1", playerId: "pl3", source: "auction", price: 5, madeAt: 0 } satisfies Pick],
    };
    expect(availablePlayerIds(state)).toEqual(["pl1"]);
  });
});
