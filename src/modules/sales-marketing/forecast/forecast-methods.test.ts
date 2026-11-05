import { describe, expect, it } from "vitest";
import { BASELINE_ASSUMPTIONS, accuracySummary, adjustPipeline, compareWithTarget, forecastError, pipelineForecast, trendForecast, type PipelineItem } from "./forecast-methods";

const item = (extra: Partial<PipelineItem>): PipelineItem => ({
  source: "QUOTATION",
  id: "q",
  number: "QUO-1",
  label: "x",
  customer: "c",
  status: "ISSUED",
  value: 1000,
  probability: 50,
  probabilitySource: "QUOTATION_DEFAULT",
  expectedDate: "2026-11-20",
  repUserId: "u1",
  territoryId: null,
  stale: false,
  ...extra,
});
const nov = { start: "2026-11-01", end: "2026-11-30" };
const today = "2026-11-10";

describe("pipeline-weighted method", () => {
  it("forecast = booked so far + value × probability of items expected in the rest of the period", () => {
    const items = adjustPipeline(
      [
        item({ id: "a", value: 1000, probability: 50 }), // 500
        item({ id: "b", value: 333.33, probability: 30, expectedDate: "2026-11-10" }), // today counts → 100
        item({ id: "c", value: 5000, probability: 90, expectedDate: "2026-12-01" }), // next month
        item({ id: "d", value: 800, probability: 40, expectedDate: "2026-11-09" }), // overdue
      ],
      BASELINE_ASSUMPTIONS,
      today
    );
    const f = pipelineForecast({ period: nov, today, actual: 2500, items });
    expect(f).toMatchObject({ state: "CURRENT", weightedPipeline: 600, unweightedPipeline: 1333.33, items: 2, forecast: 3100, overdueItems: 1, overdueWeighted: 320 });
    // Next month only sees its own items; an ended month is just its actual.
    expect(pipelineForecast({ period: { start: "2026-12-01", end: "2026-12-31" }, today, actual: 0, items }).forecast).toBe(4500);
    expect(pipelineForecast({ period: { start: "2026-10-01", end: "2026-10-31" }, today, actual: 777, items })).toMatchObject({ state: "ENDED", forecast: 777, weightedPipeline: 0 });
  });

  it("assumptions: probability factor (capped at 100 %), slip, overdue included as today, source filters", () => {
    const base = [item({ id: "a", probability: 80 }), item({ id: "o", source: "OPPORTUNITY", value: 2000, probability: 25, expectedDate: "2026-11-05" })];
    const doubled = adjustPipeline(base, { ...BASELINE_ASSUMPTIONS, probabilityFactor: 200 }, today);
    expect(doubled.map((i) => i.adjustedProbability)).toEqual([100, 50]);
    const withOverdue = adjustPipeline(base, { ...BASELINE_ASSUMPTIONS, includeOverdue: true }, today);
    expect(pipelineForecast({ period: nov, today, actual: 0, items: withOverdue }).weightedPipeline).toBe(1300);
    const slipped = adjustPipeline(base, { ...BASELINE_ASSUMPTIONS, slipDays: 15 }, today);
    expect(slipped[0].adjustedDate).toBe("2026-12-05");
    expect(pipelineForecast({ period: nov, today, actual: 0, items: slipped }).weightedPipeline).toBe(500); // the opportunity slipped to 20 Nov
    expect(adjustPipeline(base, { ...BASELINE_ASSUMPTIONS, includeOpportunities: false }, today).map((i) => i.id)).toEqual(["a"]);
    // The source items are never changed.
    expect(base[0].probability).toBe(80);
  });
});

describe("moving-average trend", () => {
  const history = [
    { start: "2026-08-01", end: "2026-08-31", label: "Aug", value: 1000 },
    { start: "2026-09-01", end: "2026-09-30", label: "Sep", value: 0 },
    { start: "2026-10-01", end: "2026-10-31", label: "Oct", value: 2000 },
  ];
  it("averages the complete periods (zero months count), with an optional growth %", () => {
    expect(trendForecast({ history, lookback: 3, firstBookedDate: "2026-08-15", growth: 0 })).toMatchObject({ available: true, value: 1000 });
    expect(trendForecast({ history, lookback: 2, firstBookedDate: "2026-08-15", growth: 10 })).toMatchObject({ available: true, value: 1100 });
  });
  it("says why there's no number instead of inventing one", () => {
    expect(trendForecast({ history, lookback: 3, firstBookedDate: null, growth: 0 })).toMatchObject({ available: false, value: null, reason: expect.stringContaining("No booked") });
    expect(trendForecast({ history, lookback: 3, firstBookedDate: "2026-09-02", growth: 0 })).toMatchObject({ available: false, reason: expect.stringContaining("Not enough history") });
    expect(trendForecast({ history: history.slice(1), lookback: 3, firstBookedDate: "2020-01-01", growth: 0 }).available).toBe(false);
  });
});

describe("target comparison", () => {
  it("gap, forecast %, still needed and coverage; no target or zero target never divides", () => {
    expect(compareWithTarget(10000, 1000, 5150, 4150)).toEqual({ target: 10000, gap: -4850, percent: 51.5, stillNeeded: 9000, coverage: 0.46 });
    expect(compareWithTarget(1000, 1200, 1500, 300)).toMatchObject({ stillNeeded: 0, coverage: null, percent: 150 });
    expect(compareWithTarget(0, 10, 10, 0)).toMatchObject({ percent: null });
    expect(compareWithTarget(null, 10, 10, 0)).toEqual({ target: null, gap: null, percent: null, stillNeeded: null, coverage: null });
  });
});

describe("accuracy", () => {
  it("error, % error only with a positive actual, and MAE / WAPE / bias over periods", () => {
    expect(forecastError(1200, 1000)).toEqual({ forecast: 1200, actual: 1000, error: 200, absoluteError: 200, percentError: 20 });
    expect(forecastError(500, 0).percentError).toBeNull();
    const s = accuracySummary([forecastError(1200, 1000), forecastError(700, 1000), forecastError(500, 0)]);
    expect(s).toEqual({ periods: 3, mae: 333.33, wape: 50, bias: 20 }); // (200+300+500)/2000, (200−300+500)/2000
    expect(accuracySummary([forecastError(10, 0)])).toMatchObject({ wape: null, bias: null, mae: 10 });
    expect(accuracySummary([])).toEqual({ periods: 0, mae: null, wape: null, bias: null });
  });
});
