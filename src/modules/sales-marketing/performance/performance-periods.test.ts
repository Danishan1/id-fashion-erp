import { describe, expect, it } from "vitest";
import { attainment, isPeriodStart, periodContaining, periodLabel, periodOptions, periodProgress, shiftPeriod } from "./performance-periods";
import { METRIC_KEYS, SALES_TARGET_METRICS, formatMetricValue } from "./performance-registry";

describe("target periods", () => {
  it("months handle month lengths and leap years", () => {
    expect(periodContaining("MONTH", "2028-02-10", 4)).toMatchObject({ start: "2028-02-01", end: "2028-02-29", label: "Feb 2028" });
    expect(periodContaining("MONTH", "2027-02-28", 4)).toMatchObject({ start: "2027-02-01", end: "2027-02-28" });
    expect(periodContaining("MONTH", "2026-12-31", 1)).toMatchObject({ start: "2026-12-01", end: "2026-12-31" });
  });

  it("quarters and years follow the fiscal year start month (April in India)", () => {
    expect(periodContaining("QUARTER", "2026-11-03", 4)).toMatchObject({ start: "2026-10-01", end: "2026-12-31", label: "Q3 FY 2026-27" });
    expect(periodContaining("QUARTER", "2027-02-15", 4)).toMatchObject({ start: "2027-01-01", end: "2027-03-31", label: "Q4 FY 2026-27" });
    expect(periodContaining("QUARTER", "2026-04-01", 4)).toMatchObject({ start: "2026-04-01", end: "2026-06-30", label: "Q1 FY 2026-27" });
    expect(periodContaining("YEAR", "2027-03-31", 4)).toMatchObject({ start: "2026-04-01", end: "2027-03-31", label: "FY 2026-27" });
    expect(periodContaining("YEAR", "2026-11-03", 1)).toMatchObject({ start: "2026-01-01", end: "2026-12-31", label: "2026" });
    expect(periodContaining("QUARTER", "2026-11-03", 1)).toMatchObject({ start: "2026-10-01", label: "Q4 2026" });
    // A fiscal year starting in a month that doesn't divide quarters evenly.
    expect(periodContaining("QUARTER", "2026-01-15", 11)).toMatchObject({ start: "2025-11-01", end: "2026-01-31", label: "Q1 FY 2025-26" });
    expect(periodLabel("YEAR", "1999-07-01", 7)).toBe("FY 1999-00");
  });

  it("knows period starts, shifts and builds picker options newest first", () => {
    expect(isPeriodStart("QUARTER", "2026-10-01", 4)).toBe(true);
    expect(isPeriodStart("QUARTER", "2026-11-01", 4)).toBe(false);
    expect(isPeriodStart("MONTH", "2026-11-02", 4)).toBe(false);
    expect(isPeriodStart("MONTH", "not a date", 4)).toBe(false);
    expect(shiftPeriod("MONTH", "2026-01-31", -1, 4).start).toBe("2025-12-01");
    expect(shiftPeriod("QUARTER", "2026-11-03", 1, 4).start).toBe("2027-01-01");
    const opts = periodOptions("MONTH", "2026-11-03", 4, 2, 1);
    expect(opts.map((p) => p.start)).toEqual(["2026-12-01", "2026-11-01", "2026-10-01", "2026-09-01"]);
  });

  it("progress: upcoming, current (today counts as elapsed) and ended", () => {
    expect(periodProgress("2026-11-01", "2026-11-30", "2026-10-31")).toEqual({ state: "UPCOMING", totalDays: 30, elapsedDays: 0, remainingDays: 30 });
    expect(periodProgress("2026-11-01", "2026-11-30", "2026-11-03")).toEqual({ state: "CURRENT", totalDays: 30, elapsedDays: 3, remainingDays: 27 });
    expect(periodProgress("2026-11-01", "2026-11-30", "2026-12-01")).toEqual({ state: "ENDED", totalDays: 30, elapsedDays: 30, remainingDays: 0 });
  });
});

describe("attainment", () => {
  const current = periodProgress("2026-11-01", "2026-11-30", "2026-11-15");
  const ended = periodProgress("2026-11-01", "2026-11-30", "2026-12-15");

  it("actual ÷ target, gap, pace against the expected-to-date share", () => {
    expect(attainment(3000, 1200, current)).toEqual({ target: 3000, actual: 1200, gap: 1800, percent: 40, expectedToDate: 1500, pace: "BEHIND" });
    expect(attainment(3000, 1600, current)).toMatchObject({ pace: "AHEAD", percent: 53.3 });
    expect(attainment(1000, 1100, ended)).toMatchObject({ gap: -100, percent: 110, pace: "MET", expectedToDate: null });
    expect(attainment(1000, 999.99, ended)).toMatchObject({ percent: 100, pace: "MISSED" });
  });

  it("no approved target or a zero target never divides (no ∞ %)", () => {
    expect(attainment(null, 500, current)).toEqual({ target: null, actual: 500, gap: null, percent: null, expectedToDate: null, pace: null });
    expect(attainment(0, 500, current)).toMatchObject({ target: 0, gap: -500, percent: null, pace: null });
  });
});

describe("metric registry", () => {
  it("defines every metric once with a source, unit, definition and date basis", () => {
    expect(new Set(METRIC_KEYS).size).toBe(SALES_TARGET_METRICS.length);
    for (const m of SALES_TARGET_METRICS) {
      expect(m.definition.length).toBeGreaterThan(40);
      expect(m.dateBasis).toBeTruthy();
    }
    // Quotations are never booked sales; invoiced value is not "revenue".
    expect(SALES_TARGET_METRICS.find((m) => m.key === "ACCEPTED_QUOTATION_VALUE")!.definition).toContain("Not booked sales");
    expect(SALES_TARGET_METRICS.find((m) => m.key === "INVOICED_VALUE")!.definition).toContain("not revenue");
  });

  it("formats values by unit", () => {
    expect(formatMetricValue("CURRENCY", 123456.5)).toBe("₹1,23,456.50");
    expect(formatMetricValue("PIECES", 1200)).toBe("1,200 pcs");
    expect(formatMetricValue("COUNT", 7)).toBe("7");
  });
});
