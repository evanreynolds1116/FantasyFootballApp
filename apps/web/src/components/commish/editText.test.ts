import type { CommishEdit } from "@draft-app/engine";
import { describe, expect, it } from "vitest";
import { editText } from "./editText";

const snapshot = {
  teams: [
    { id: "t1", draftNumber: 1, name: "Alpha" },
    { id: "t4", draftNumber: 4, name: "Delta" },
  ],
  players: [{ id: "p1", name: "Keenan Owens", position: "K" }],
};
const base = { id: "edit_1", at: 0 };

describe("editText", () => {
  it("describes budget changes both ways, with the reason", () => {
    expect(editText({ ...base, kind: "budget", teamId: "t4", amount: 25, reason: "Prize money" }, snapshot)).toBe("Team 4's budget +$25 — Prize money");
    expect(editText({ ...base, kind: "budget", teamId: "t1", amount: -10, reason: "Fix" }, snapshot)).toBe("Team 1's budget −$10 — Fix");
  });

  it("describes roster changes, with the price only where there was one", () => {
    const removed: CommishEdit = { ...base, kind: "remove", teamId: "t1", playerId: "p1", pickId: "x", source: "auction", price: 40 };
    expect(editText(removed, snapshot)).toBe("Keenan Owens taken off Team 1 ($40 refunded) and back in the pool");
    expect(editText({ ...removed, source: "snake", price: null }, snapshot)).toBe("Keenan Owens taken off Team 1 and back in the pool");
    expect(editText({ ...base, kind: "assign", teamId: "t4", playerId: "p1", pickId: "y", slot: "auction", price: 15 }, snapshot)).toBe(
      "Keenan Owens added to Team 4 ($15)",
    );
    expect(editText({ ...base, kind: "assign", teamId: "t4", playerId: "p1", pickId: "y", slot: "snake", price: null }, snapshot)).toBe(
      "Keenan Owens added to Team 4 (snake spot)",
    );
  });

  it("describes voids and availability changes", () => {
    expect(editText({ ...base, kind: "void", lotId: "lot_1", playerId: "p1" }, snapshot)).toBe("Lot voided — Keenan Owens goes back in the pool, bids stay sealed");
    expect(editText({ ...base, kind: "unavailable", playerId: "p1" }, snapshot)).toBe("Keenan Owens marked unavailable");
    expect(editText({ ...base, kind: "available", playerId: "p1" }, snapshot)).toBe("Keenan Owens is available again");
  });
});
