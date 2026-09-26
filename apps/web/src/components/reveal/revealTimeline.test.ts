import { REVEAL_HOLD_MS } from "@draft-app/engine";
import { describe, expect, it } from "vitest";
import { COUNT_UP_MS, countUpValue, planReveal, SEALED_MS } from "./revealTimeline";

const bid = (teamId: string, amount: number) => ({ teamId, amount });

describe("planReveal", () => {
  it("flips runner-ups lowest first after the sealed stage, then the winner after a beat", () => {
    const plan = planReveal([bid("t4", 220), bid("t2", 205), bid("t7", 180)], "t4");
    expect(plan.flips.map((f) => [f.bid.teamId, f.at])).toEqual([
      ["t7", SEALED_MS],
      ["t2", SEALED_MS + 800],
    ]);
    expect(plan.top).toEqual([bid("t4", 220)]);
    expect(plan.tie).toBe(false);
    expect(plan.suspenseAt).toBe(SEALED_MS + 1600);
    expect(plan.topAt).toBe(plan.suspenseAt! + 1000);
    expect(plan.detailsAt).toBeGreaterThan(plan.topAt);
  });

  it("fits the whole show inside the reveal even when every bid is shown", () => {
    const bids = Array.from({ length: 12 }, (_, i) => bid(`t${i}`, 300 - i * 5));
    const plan = planReveal(bids, "t0");
    expect(plan.flips).toHaveLength(11);
    expect(plan.detailsAt + COUNT_UP_MS).toBeLessThan(REVEAL_HOLD_MS);
  });

  it("goes straight from the sealed stage to the winner when only the winner is shown", () => {
    const plan = planReveal([bid("t3", 50)], "t3");
    expect(plan.flips).toEqual([]);
    expect(plan.topAt).toBe(SEALED_MS + 1000);
  });

  it("flips every team tied at the top together", () => {
    const plan = planReveal([bid("t1", 250), bid("t5", 250), bid("t9", 220)], null);
    expect(plan.tie).toBe(true);
    expect(plan.top.map((b) => b.teamId)).toEqual(["t1", "t5"]);
    expect(plan.flips.map((f) => f.bid.teamId)).toEqual(["t9"]);
  });

  it("keeps it short when nobody bid", () => {
    const plan = planReveal([], null);
    expect(plan.top).toEqual([]);
    expect(plan.suspenseAt).toBeNull();
    expect(plan.topAt).toBeLessThan(SEALED_MS);
  });

  it("speeds the drumroll up", () => {
    const { ticks } = planReveal([bid("t1", 10)], "t1");
    const gaps = ticks.slice(1).map((t, i) => t - ticks[i]!);
    expect(gaps[0]).toBeGreaterThan(gaps[gaps.length - 1]!);
    expect(ticks[ticks.length - 1]).toBeLessThan(SEALED_MS);
  });
});

describe("countUpValue", () => {
  it("runs from the runner-up to the price, landing exactly on it", () => {
    expect(countUpValue(205, 220, 0)).toBe(205);
    expect(countUpValue(205, 220, COUNT_UP_MS / 2)).toBeGreaterThan(212);
    expect(countUpValue(205, 220, COUNT_UP_MS)).toBe(220);
    expect(countUpValue(205, 220, 99_999)).toBe(220);
  });
});
