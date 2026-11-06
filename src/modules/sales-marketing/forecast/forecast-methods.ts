/**
 * Forecast methods (Sales & Marketing Phase 06, PHASE_06_FORECAST.md §4–§7).
 * Pure and client-safe: no database, no dates from the clock — every input is
 * passed in, so the same inputs always give the same forecast (snapshots,
 * scenarios and tests rely on that).
 *
 * Each method is a small strategy with the same output shape, so another one
 * can be added without touching the screens, API or snapshots.
 */

export type PipelineSource = "QUOTATION" | "OPPORTUNITY";
export type ProbabilitySource = "OPPORTUNITY" | "QUOTATION_DEFAULT";

/** One open pipeline record that can become a Sales Order. */
export interface PipelineItem {
  source: PipelineSource;
  id: string;
  number: string;
  label: string;
  customer: string;
  status: string;
  /** ₹ before GST. */
  value: number;
  /** 0–100. */
  probability: number;
  probabilitySource: ProbabilitySource;
  /** YYYY-MM-DD. */
  expectedDate: string;
  repUserId: string | null;
  territoryId: string | null;
  /** Opportunity not updated for longer than the stale threshold. */
  stale: boolean;
  /** The opportunity this quotation stands for, if any. */
  opportunityNumber?: string | null;
}

export type ExclusionReason = "NO_DATE" | "NO_VALUE" | "NO_PROBABILITY" | "OTHER_CURRENCY" | "EXPIRED" | "REPRESENTED" | "ORDERED";

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  NO_DATE: "No expected close date",
  NO_VALUE: "No amount",
  NO_PROBABILITY: "No probability",
  OTHER_CURRENCY: "Not in the company currency",
  EXPIRED: "Quotation expired (valid-until passed)",
  REPRESENTED: "Counted through its quotation",
  ORDERED: "Already a Sales Order",
};
/** De-duplication, not a data problem — not shown as a warning. */
export const DEDUP_REASONS: ExclusionReason[] = ["REPRESENTED", "ORDERED"];

export interface ExcludedItem {
  source: PipelineSource;
  id: string;
  number: string;
  label: string;
  value: number | null;
  reason: ExclusionReason;
  detail?: string;
  repUserId: string | null;
  territoryId: string | null;
}

/** What-if assumptions (scenarios). The baseline is `BASELINE_ASSUMPTIONS`. */
export interface ForecastAssumptions {
  /** % applied to every probability (100 = unchanged); results capped at 100 %. */
  probabilityFactor: number;
  /** Expected dates moved later by this many days. */
  slipDays: number;
  /** Count items whose expected date has passed as if expected today. */
  includeOverdue: boolean;
  includeQuotations: boolean;
  includeOpportunities: boolean;
  /** % added to (or taken off) the trend estimate. */
  trendGrowth: number;
}

export const BASELINE_ASSUMPTIONS: ForecastAssumptions = {
  probabilityFactor: 100,
  slipDays: 0,
  includeOverdue: false,
  includeQuotations: true,
  includeOpportunities: true,
  trendGrowth: 0,
};

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export interface AdjustedItem extends PipelineItem {
  /** After assumptions. */
  adjustedProbability: number;
  adjustedDate: string;
  overdue: boolean;
  weighted: number;
}

/** Applies the assumptions to the pipeline (pure; the source records never change). */
export function adjustPipeline(items: PipelineItem[], a: ForecastAssumptions, today: string): AdjustedItem[] {
  return items
    .filter((i) => (i.source === "QUOTATION" ? a.includeQuotations : a.includeOpportunities))
    .map((i) => {
      const adjustedProbability = Math.min(100, Math.max(0, (i.probability * a.probabilityFactor) / 100));
      let adjustedDate = a.slipDays ? addDays(i.expectedDate, a.slipDays) : i.expectedDate;
      const overdue = adjustedDate < today;
      if (overdue && a.includeOverdue) adjustedDate = today;
      return { ...i, adjustedProbability, adjustedDate, overdue, weighted: r2((i.value * adjustedProbability) / 100) };
    });
}

export interface PipelineForecast {
  method: "PIPELINE";
  state: "UPCOMING" | "CURRENT" | "ENDED";
  actual: number;
  /** Σ value × probability of items expected in the rest of the period. */
  weightedPipeline: number;
  unweightedPipeline: number;
  items: number;
  /** actual + weighted pipeline (= actual once the period has ended). */
  forecast: number;
  /** Items left out because their (adjusted) expected date has passed. */
  overdueItems: number;
  overdueWeighted: number;
}

/** Items counted in the period's forecast window [max(today, start), end]. */
export function itemsInWindow(items: AdjustedItem[], period: { start: string; end: string }, today: string) {
  const from = today > period.start ? today : period.start;
  if (today > period.end) return [];
  return items.filter((i) => !(i.overdue && i.adjustedDate < today) && i.adjustedDate >= from && i.adjustedDate <= period.end);
}

/** Pipeline-weighted method: booked so far + weighted open pipeline expected in the rest of the period. */
export function pipelineForecast(input: { period: { start: string; end: string }; today: string; actual: number; items: AdjustedItem[] }): PipelineForecast {
  const { period, today, actual } = input;
  const state = today > period.end ? "ENDED" : today < period.start ? "UPCOMING" : "CURRENT";
  const overdue = state === "ENDED" ? [] : input.items.filter((i) => i.adjustedDate < today);
  if (state === "ENDED") return { method: "PIPELINE", state, actual, weightedPipeline: 0, unweightedPipeline: 0, items: 0, forecast: actual, overdueItems: 0, overdueWeighted: 0 };
  const inWindow = itemsInWindow(input.items, period, today);
  const weightedPipeline = r2(inWindow.reduce((s, i) => s + i.weighted, 0));
  const unweightedPipeline = r2(inWindow.reduce((s, i) => s + i.value, 0));
  return {
    method: "PIPELINE",
    state,
    actual,
    weightedPipeline,
    unweightedPipeline,
    items: inWindow.length,
    forecast: r2(actual + weightedPipeline),
    overdueItems: overdue.length,
    overdueWeighted: r2(overdue.reduce((s, i) => s + i.weighted, 0)),
  };
}

export interface TrendForecast {
  method: "TREND";
  available: boolean;
  /** Why there is no number. */
  reason: string | null;
  value: number | null;
  /** The periods averaged, oldest first. */
  basis: { start: string; label: string; value: number }[];
  growth: number;
}

/**
 * Moving average of the `lookback` complete periods just before the forecast
 * period, times (1 + growth). Needs the company's first booked order to fall
 * on or before the start of the earliest of those periods' own period, i.e.
 * every averaged period is a full period of trading history.
 */
export function trendForecast(input: { history: { start: string; end: string; label: string; value: number }[]; lookback: number; firstBookedDate: string | null; growth: number }): TrendForecast {
  const { history, lookback, firstBookedDate, growth } = input;
  const basis = history.slice(-lookback).map((h) => ({ start: h.start, label: h.label, value: h.value }));
  const none = (reason: string): TrendForecast => ({ method: "TREND", available: false, reason, value: null, basis, growth });
  if (!firstBookedDate) return none("No booked Sales Orders yet, so there is no history to average.");
  if (basis.length < lookback) return none(`Needs ${lookback} complete earlier periods.`);
  const earliest = history.slice(-lookback)[0];
  if (firstBookedDate > earliest.end) return none(`Not enough history: the first booked order is on ${firstBookedDate}; ${lookback} complete periods are needed before this one.`);
  const avg = basis.reduce((s, b) => s + b.value, 0) / basis.length;
  return { method: "TREND", available: true, reason: null, value: r2(avg * (1 + growth / 100)), basis, growth };
}

// ── Target comparison ────────────────────────────────────────────

export interface TargetComparison {
  target: number | null;
  /** forecast − target (negative = short). */
  gap: number | null;
  /** forecast ÷ target × 100, 1 dp; null without a positive target. */
  percent: number | null;
  /** target − actual, never below 0. */
  stillNeeded: number | null;
  /** weighted pipeline ÷ still needed (×, 2 dp); null when nothing is still needed. */
  coverage: number | null;
}

export function compareWithTarget(target: number | null, actual: number, forecast: number, weightedPipeline: number): TargetComparison {
  if (target === null) return { target: null, gap: null, percent: null, stillNeeded: null, coverage: null };
  const stillNeeded = r2(Math.max(0, target - actual));
  return {
    target,
    gap: r2(forecast - target),
    percent: target > 0 ? Math.round((forecast / target) * 1000) / 10 : null,
    stillNeeded,
    coverage: stillNeeded > 0 ? Math.round((weightedPipeline / stillNeeded) * 100) / 100 : null,
  };
}

// ── Accuracy (PHASE_06 §6) ───────────────────────────────────────

export interface ForecastError {
  forecast: number;
  actual: number;
  error: number;
  absoluteError: number;
  /** error ÷ actual × 100, 1 dp; null when actual is 0. */
  percentError: number | null;
}

export function forecastError(forecast: number, actual: number): ForecastError {
  const error = r2(forecast - actual);
  return { forecast, actual, error, absoluteError: Math.abs(error), percentError: actual > 0 ? Math.round((error / actual) * 1000) / 10 : null };
}

export interface AccuracySummary {
  periods: number;
  /** Mean absolute error, ₹. */
  mae: number | null;
  /** Σ|error| ÷ Σ actual × 100; null when Σ actual is 0. */
  wape: number | null;
  /** Σ error ÷ Σ actual × 100 (positive = forecasts too high); null when Σ actual is 0. */
  bias: number | null;
}

export function accuracySummary(errors: ForecastError[]): AccuracySummary {
  if (!errors.length) return { periods: 0, mae: null, wape: null, bias: null };
  const sumAbs = errors.reduce((s, e) => s + e.absoluteError, 0);
  const sumErr = errors.reduce((s, e) => s + e.error, 0);
  const sumAct = errors.reduce((s, e) => s + e.actual, 0);
  return {
    periods: errors.length,
    mae: r2(sumAbs / errors.length),
    wape: sumAct > 0 ? Math.round((sumAbs / sumAct) * 1000) / 10 : null,
    bias: sumAct > 0 ? Math.round((sumErr / sumAct) * 1000) / 10 : null,
  };
}
