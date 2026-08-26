import { describe, expect, it } from "vitest";
import { round2 } from "./money";

describe("round2", () => {
  it("rounds away IEEE-754 accumulation noise to exactly 2 decimals", () => {
    expect(round2(49.600000000000364)).toBe(49.6);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(2608.05 - 2558.45)).toBe(49.6);
  });

  it("collapses near-zero floating-point noise to exactly 0", () => {
    expect(round2(1.0658141036401503e-14)).toBe(0);
    expect(round2(-1.4551915228366852e-11)).toBe(0);
  });

  it("leaves already-clean values untouched", () => {
    expect(round2(100)).toBe(100);
    expect(round2(42.6)).toBe(42.6);
    expect(round2(0)).toBe(0);
  });

  it("passes through non-finite values instead of producing NaN/garbage", () => {
    expect(round2(Infinity)).toBe(Infinity);
    expect(round2(NaN)).toBeNaN();
  });
});
