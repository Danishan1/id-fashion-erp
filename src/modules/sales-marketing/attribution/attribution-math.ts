import { Prisma } from "@prisma/client";
import type { ModelType, TouchpointType } from "./attribution-registry";

/**
 * Attribution arithmetic (Sales & Marketing Phase 13) — pure, no database.
 * Decimal throughout (Prisma.Decimal = decimal.js).
 *
 * Eligibility (per conversion):
 *   a touch is eligible when it is VALID, of an allowed type ("message sent"
 *   includes messages later confirmed delivered), for a message of an
 *   allowed channel, shares at least one identity key with the
 *   conversion, and  conversionAt − window ≤ occurredAt ≤ conversionAt
 *   (both ends included; later touches never count).
 * Order: occurredAt ascending, then id ascending (deterministic ties).
 * Repeats (optional): one touch per (campaign, touch type) — the earliest
 *   for first-touch, otherwise the latest.
 *
 * Weights (n eligible touches, i = 1…n in order), each rounded to 10 dp,
 * the rounding difference given to the largest weight (earliest on a tie),
 * so they add up to exactly 1:
 *   FIRST_TOUCH     w1 = 1
 *   LAST_TOUCH      wn = 1
 *   LINEAR          wi = 1 / n
 *   POSITION_BASED  n = 1: 1;  n = 2: f/(f+l), l/(f+l) (½ each if f+l = 0);
 *                   n ≥ 3: w1 = f, wn = l, middle (1 − f − l)/(n − 2) each
 *   TIME_DECAY      raw_i = 2^(−age_i / h), age in days before the conversion; wi = raw_i / Σ raw
 * Money: value × weight per touch, in paisa, largest-remainder rounding (ties
 *   to the earlier touch), so the credits add up to exactly the value.
 * No eligible touch → the conversion is UNATTRIBUTED; no credit is invented.
 */

const Dec = Prisma.Decimal;
type Dec = Prisma.Decimal;
const DAY_MS = 86_400_000;
export const WEIGHT_DP = 10;

export interface Touch {
  id: string;
  campaignId: string;
  touchpointType: TouchpointType;
  channelType: string | null;
  occurredAt: Date;
  identityKeys: string[];
  status: string;
}

export interface Rules {
  modelType: ModelType;
  windowDays: number;
  touchpointTypes: string[];
  channelTypes: string[];
  collapseRepeats: boolean;
  firstTouchPercent: number | null;
  lastTouchPercent: number | null;
  halfLifeDays: number | null;
}

export const windowStart = (conversionAt: Date, windowDays: number) => new Date(conversionAt.getTime() - windowDays * DAY_MS);

const byTime = (a: Touch, b: Touch) => a.occurredAt.getTime() - b.occurredAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Eligible touches in order (see the header for the rules). */
export function eligibleTouches(touches: Touch[], conversion: { at: Date; identityKeys: string[] }, rules: Rules): Touch[] {
  const keys = new Set(conversion.identityKeys);
  const from = windowStart(conversion.at, rules.windowDays).getTime();
  const to = conversion.at.getTime();
  const seen = new Set<string>();
  const ok = touches
    .filter((t) => {
      if (t.status !== "VALID") return false;
      // "Message sent" also covers messages later confirmed delivered (a delivered message was sent).
      const typeOk = rules.touchpointTypes.includes(t.touchpointType) || (t.touchpointType === "MESSAGE_DELIVERED" && rules.touchpointTypes.includes("MESSAGE_SENT"));
      if (!typeOk) return false;
      if (t.touchpointType !== "CAMPAIGN_RESPONSE" && rules.channelTypes.length && (!t.channelType || !rules.channelTypes.includes(t.channelType))) return false;
      const at = t.occurredAt.getTime();
      if (at < from || at > to) return false;
      if (seen.has(t.id)) return false; // the same touch reached through two keys
      if (!t.identityKeys.some((k) => keys.has(k))) return false;
      seen.add(t.id);
      return true;
    })
    .sort(byTime);
  if (!rules.collapseRepeats) return ok;
  const keep = new Map<string, Touch>();
  for (const t of ok) {
    const k = `${t.campaignId}|${t.touchpointType}`;
    if (rules.modelType === "FIRST_TOUCH") {
      if (!keep.has(k)) keep.set(k, t);
    } else keep.set(k, t);
  }
  return [...keep.values()].sort(byTime);
}

/** Exact-sum normalisation at WEIGHT_DP. */
function normalise(raw: Dec[]): Dec[] {
  const total = raw.reduce((s, v) => s.add(v), new Dec(0));
  if (total.lte(0)) throw new Error("Weights must have a positive total");
  const w = raw.map((v) => v.div(total).toDecimalPlaces(WEIGHT_DP, Dec.ROUND_HALF_UP));
  const diff = new Dec(1).sub(w.reduce((s, v) => s.add(v), new Dec(0)));
  if (!diff.isZero()) {
    let idx = 0;
    for (let i = 1; i < w.length; i++) if (w[i].gt(w[idx])) idx = i;
    w[idx] = w[idx].add(diff);
  }
  return w;
}

/** Weights for touches already in order. Throws for an empty list (callers classify that as unattributed). */
export function weightsFor(touches: Pick<Touch, "occurredAt">[], conversionAt: Date, rules: Pick<Rules, "modelType" | "firstTouchPercent" | "lastTouchPercent" | "halfLifeDays">): Dec[] {
  const n = touches.length;
  if (n === 0) throw new Error("No touches to weight");
  const one = (i: number) => touches.map((_, j) => new Dec(j === i ? 1 : 0));
  switch (rules.modelType) {
    case "FIRST_TOUCH":
      return one(0);
    case "LAST_TOUCH":
      return one(n - 1);
    case "LINEAR":
      return normalise(touches.map(() => new Dec(1)));
    case "POSITION_BASED": {
      const f = new Dec(rules.firstTouchPercent ?? 0).div(100);
      const l = new Dec(rules.lastTouchPercent ?? 0).div(100);
      if (n === 1) return [new Dec(1)];
      if (n === 2) return f.add(l).isZero() ? normalise([new Dec(1), new Dec(1)]) : normalise([f, l]);
      const middle = new Dec(1).sub(f).sub(l).div(n - 2);
      const raw = touches.map((_, i) => (i === 0 ? f : i === n - 1 ? l : middle));
      // All weight on the ends with nothing left for the middle: middle touches get none.
      return normalise(raw);
    }
    case "TIME_DECAY": {
      const h = new Dec(rules.halfLifeDays ?? 7);
      const raw = touches.map((t) => {
        const ageDays = new Dec(Math.max(0, conversionAt.getTime() - t.occurredAt.getTime())).div(DAY_MS);
        return new Dec(2).pow(ageDays.div(h).neg());
      });
      return normalise(raw);
    }
  }
}

/** Splits a money value by weights so the parts add up to exactly the value (paisa, largest remainder). */
export function allocateMoney(value: Dec | number | string, weights: Dec[]): Dec[] {
  const paisa = new Dec(value).mul(100).toDecimalPlaces(0, Dec.ROUND_HALF_UP);
  const exact = weights.map((w) => paisa.mul(w));
  const floors = exact.map((e) => e.floor());
  let left = paisa.sub(floors.reduce((s, v) => s.add(v), new Dec(0))).toNumber();
  const order = exact.map((e, i) => ({ i, rem: e.sub(floors[i]) })).sort((a, b) => b.rem.cmp(a.rem) || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    if (weights[o.i].isZero()) continue;
    floors[o.i] = floors[o.i].add(1);
    left--;
  }
  return floors.map((p) => p.div(100));
}

// ── KPIs ───────────────────────────────────────────────────────────

export type Ratio = { value: number; status: "OK" } | { value: null; status: "NO_COST" | "NO_REVENUE_BASIS" | "NO_DATA" };

/**
 * Revenue-based ROI % = (attributed revenue − actual marketing cost) ÷ cost × 100.
 * Not profit: revenue isn't margin. No percentage when cost is zero or unknown.
 */
export function roiPercent(revenue: number | null, cost: number | null): Ratio {
  if (revenue === null) return { value: null, status: "NO_REVENUE_BASIS" };
  if (cost === null || cost <= 0) return { value: null, status: "NO_COST" };
  return { value: Math.round(((revenue - cost) / cost) * 1000) / 10, status: "OK" };
}

/** Revenue per rupee of actual marketing cost (ROAS). Same rule for zero / unknown cost. */
export function roas(revenue: number | null, cost: number | null): Ratio {
  if (revenue === null) return { value: null, status: "NO_REVENUE_BASIS" };
  if (cost === null || cost <= 0) return { value: null, status: "NO_COST" };
  return { value: Math.round((revenue / cost) * 100) / 100, status: "OK" };
}

/** Cost per credited conversion; null when nothing was credited or there is no cost. */
export function costPer(cost: number | null, credited: number): number | null {
  if (cost === null || cost <= 0 || credited <= 0) return null;
  return Math.round((cost / credited) * 100) / 100;
}

/** The moment a date-only business event counts as having happened: the end of that day, India time. */
export function endOfBusinessDay(isoDate: string, offsetMinutes = 330): Date {
  const midnightUtc = Date.parse(`${isoDate}T00:00:00Z`);
  return new Date(midnightUtc + DAY_MS - offsetMinutes * 60_000 - 1);
}
