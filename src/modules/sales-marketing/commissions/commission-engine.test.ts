import { describe, expect, it } from "vitest";
import { collectedBasis, commissionFor, incentiveReward, incentiveTierProblems, spread, tierProblems, type CommissionRule } from "./commission-engine";

const rule = (extra: Partial<CommissionRule> = {}): CommissionRule => ({
  method: "PERCENT",
  tierMode: "ALL_UNITS",
  tiers: [
    { from: 0, rate: 2 },
    { from: 100000, rate: 3 },
  ],
  fixedAmount: null,
  minimumBasis: null,
  capAmount: null,
  ...extra,
});

describe("commission tiers", () => {
  it("all-units vs progressive — the documented ₹1,50,000 example", () => {
    expect(commissionFor(rule(), 150000, 3)).toMatchObject({ amount: 4500, effectiveRate: 3, capped: false });
    const p = commissionFor(rule({ tierMode: "PROGRESSIVE" }), 150000, 3);
    expect(p.amount).toBe(3500);
    expect(p.slices).toEqual([
      { from: 0, to: 100000, rate: 2, basis: 100000, amount: 2000 },
      { from: 100000, to: null, rate: 3, basis: 50000, amount: 1500 },
    ]);
  });

  it("boundaries are inclusive at the start of a tier", () => {
    expect(commissionFor(rule(), 100000, 1).amount).toBe(3000);
    expect(commissionFor(rule(), 99999.99, 1).amount).toBe(2000);
    expect(commissionFor(rule({ tierMode: "PROGRESSIVE" }), 100000, 1).amount).toBe(2000);
  });

  it("minimum basis, cap, fixed per invoice, nothing on zero or negative", () => {
    expect(commissionFor(rule({ minimumBasis: 50000 }), 49999, 2)).toMatchObject({ amount: 0, belowMinimum: true });
    expect(commissionFor(rule({ minimumBasis: 50000 }), 50000, 2).amount).toBe(1000);
    expect(commissionFor(rule({ capAmount: 4000 }), 150000, 3)).toMatchObject({ amount: 4000, gross: 4500, capped: true });
    expect(commissionFor(rule({ method: "FIXED", fixedAmount: 250 }), 99999, 3).amount).toBe(750);
    expect(commissionFor(rule(), 0, 0).amount).toBe(0);
    expect(commissionFor(rule(), -5, 1).amount).toBe(0);
  });

  it("rounds once to the paisa", () => {
    expect(commissionFor(rule({ tiers: [{ from: 0, rate: 2.5 }] }), 333.33, 1).amount).toBe(8.33);
  });

  it("validates tiers: start at 0, strictly increasing, rate 0–100", () => {
    expect(tierProblems(rule().tiers)).toEqual([]);
    expect(tierProblems([])).toContain("Add at least one rate.");
    expect(tierProblems([{ from: 10, rate: 1 }])).toContain("The first tier must start at ₹0.");
    expect(tierProblems([{ from: 0, rate: 1 }, { from: 0, rate: 2 }])[0]).toMatch(/start above the previous/);
    expect(tierProblems([{ from: 0, rate: 101 }])[0]).toMatch(/between 0% and 100%/);
  });
});

describe("spreading a total over lines", () => {
  it("adds up exactly, remainder on the heaviest line", () => {
    const parts = spread(100, [1, 1, 1]);
    expect(parts.reduce((s, v) => s + v, 0)).toBeCloseTo(100, 10);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
    expect(spread(4500, [50000, 100000])).toEqual([1500, 3000]);
    expect(spread(10, [0, 0])).toEqual([10, 0]);
  });
});

describe("incentives", () => {
  const tiers = [
    { attainment: 90, reward: 2000 },
    { attainment: 100, reward: 5000 },
    { attainment: 120, reward: 8000 },
  ];
  it("highest tier reached wins (not cumulative); no target → nothing", () => {
    expect(incentiveReward(tiers, 89.9)).toBeNull();
    expect(incentiveReward(tiers, 90)?.reward).toBe(2000);
    expect(incentiveReward(tiers, 110)?.reward).toBe(5000);
    expect(incentiveReward(tiers, 150)?.reward).toBe(8000);
    expect(incentiveReward(tiers, null)).toBeNull();
  });
  it("validates reward tiers", () => {
    expect(incentiveTierProblems(tiers)).toEqual([]);
    expect(incentiveTierProblems([{ attainment: 100, reward: 5000 }, { attainment: 90, reward: 6000 }])[0]).toMatch(/higher than the previous/);
    expect(incentiveTierProblems([{ attainment: 90, reward: 5000 }, { attainment: 100, reward: 1000 }])[0]).toMatch(/can't pay less/);
  });
});

describe("collected basis", () => {
  it("removes the GST share of a payment", () => {
    expect(collectedBasis(1050, 1000, 1050)).toBe(1000);
    expect(collectedBasis(525, 1000, 1050)).toBe(500);
    expect(collectedBasis(100, 0, 0)).toBe(0);
  });
});
