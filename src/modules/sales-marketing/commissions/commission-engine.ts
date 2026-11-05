/**
 * Commission and incentive maths (Sales & Marketing Phase 07,
 * PHASE_07_COMMISSIONS.md §3–§5). Pure and client-safe: no database, no
 * clock. The statement service collects the events; everything that turns a
 * basis into money is here, so screens, statements and tests share one rule.
 */

export type CommissionMethod = "PERCENT" | "FIXED";
export type TierMode = "ALL_UNITS" | "PROGRESSIVE";

export interface CommissionTier {
  /** Basis (₹) from which this rate applies; the first tier starts at 0. */
  from: number;
  /** % of the basis. */
  rate: number;
}

export interface CommissionRule {
  method: CommissionMethod;
  tierMode: TierMode;
  tiers: CommissionTier[];
  fixedAmount: number | null;
  minimumBasis: number | null;
  capAmount: number | null;
}

export interface IncentiveTier {
  /** Attainment % at which the reward is earned (inclusive). */
  attainment: number;
  /** ₹ reward. */
  reward: number;
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const MAX_TIERS = 10;

/** Problems with a tier list, in words (empty = valid). */
export function tierProblems(tiers: CommissionTier[]): string[] {
  const out: string[] = [];
  if (!tiers.length) out.push("Add at least one rate.");
  if (tiers.length > MAX_TIERS) out.push(`At most ${MAX_TIERS} tiers.`);
  if (tiers.length && tiers[0].from !== 0) out.push("The first tier must start at ₹0.");
  tiers.forEach((t, i) => {
    if (!Number.isFinite(t.from) || t.from < 0) out.push(`Tier ${i + 1}: the starting amount can't be negative.`);
    if (!Number.isFinite(t.rate) || t.rate < 0 || t.rate > 100) out.push(`Tier ${i + 1}: the rate must be between 0% and 100%.`);
    if (i > 0 && !(t.from > tiers[i - 1].from)) out.push(`Tier ${i + 1}: each tier must start above the previous one (no gaps or overlaps — a tier runs up to the next one's start).`);
  });
  return out;
}

export function incentiveTierProblems(tiers: IncentiveTier[]): string[] {
  const out: string[] = [];
  if (!tiers.length) out.push("Add at least one reward tier.");
  if (tiers.length > MAX_TIERS) out.push(`At most ${MAX_TIERS} tiers.`);
  tiers.forEach((t, i) => {
    if (!Number.isFinite(t.attainment) || t.attainment <= 0 || t.attainment > 1000) out.push(`Tier ${i + 1}: attainment must be above 0% (and at most 1000%).`);
    if (!Number.isFinite(t.reward) || t.reward < 0) out.push(`Tier ${i + 1}: the reward can't be negative.`);
    if (i > 0 && !(t.attainment > tiers[i - 1].attainment)) out.push(`Tier ${i + 1}: attainment must be higher than the previous tier's.`);
    if (i > 0 && t.reward < tiers[i - 1].reward) out.push(`Tier ${i + 1}: a higher tier can't pay less than a lower one.`);
  });
  return out;
}

export interface TierSlice {
  from: number;
  to: number | null;
  rate: number;
  /** Basis falling in this slice (progressive) or the whole basis (all-units). */
  basis: number;
  amount: number;
}

export interface CommissionResult {
  basis: number;
  events: number;
  /** Commission before the cap, unrounded tiers summed. */
  gross: number;
  /** Final, rounded once to the paisa. */
  amount: number;
  /** amount ÷ basis × 100 (4 dp); null when the basis is 0. */
  effectiveRate: number | null;
  belowMinimum: boolean;
  capped: boolean;
  slices: TierSlice[];
}

/**
 * Commission for one payee, one plan version, one month.
 * Order: minimum basis → tiers (all-units or progressive) or fixed × events → cap → round.
 */
export function commissionFor(rule: CommissionRule, basis: number, events: number): CommissionResult {
  const base: CommissionResult = { basis: r2(basis), events, gross: 0, amount: 0, effectiveRate: null, belowMinimum: false, capped: false, slices: [] };
  if (basis <= 0 || events <= 0) return base;
  if (rule.minimumBasis !== null && basis < rule.minimumBasis) return { ...base, belowMinimum: true, effectiveRate: 0 };

  let gross = 0;
  const slices: TierSlice[] = [];
  if (rule.method === "FIXED") {
    gross = (rule.fixedAmount ?? 0) * events;
  } else if (rule.tierMode === "ALL_UNITS") {
    const idx = rule.tiers.reduce((k, t, i) => (t.from <= basis ? i : k), 0);
    const t = rule.tiers[idx];
    gross = (basis * t.rate) / 100;
    slices.push({ from: t.from, to: rule.tiers[idx + 1]?.from ?? null, rate: t.rate, basis, amount: r2(gross) });
  } else {
    rule.tiers.forEach((t, i) => {
      const to = rule.tiers[i + 1]?.from ?? null;
      const slice = Math.max(0, Math.min(basis, to ?? Infinity) - t.from);
      if (slice <= 0) return;
      const amt = (slice * t.rate) / 100;
      gross += amt;
      slices.push({ from: t.from, to, rate: t.rate, basis: r2(slice), amount: r2(amt) });
    });
  }
  const capped = rule.capAmount !== null && gross > rule.capAmount;
  const amount = r2(capped ? rule.capAmount! : gross);
  return { ...base, gross: r2(gross), amount, effectiveRate: Math.round((amount / basis) * 1_000_000) / 10_000, capped, slices };
}

/**
 * Spreads `total` over lines by weight (basis, or 1 per event for fixed
 * commission), in paise, putting the rounding remainder on the heaviest line —
 * so the lines always add up to the total exactly.
 */
export function spread(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const sum = weights.reduce((s, w) => s + w, 0);
  const paise = Math.round(total * 100);
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => Math.floor((paise * w) / sum));
  let rest = paise - raw.reduce((s, v) => s + v, 0);
  const order = weights.map((w, i) => [w, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) raw[order[k][1]]++;
  return raw.map((p) => p / 100);
}

/** Highest reward tier reached by `attainment` %, or null. Not cumulative. */
export function incentiveReward(tiers: IncentiveTier[], attainment: number | null): IncentiveTier | null {
  if (attainment === null) return null;
  let best: IncentiveTier | null = null;
  for (const t of tiers) if (attainment >= t.attainment) best = t;
  return best;
}

/** Collected basis: the share of a payment allocation that isn't GST. */
export function collectedBasis(allocated: number, invoiceSubtotal: number, invoiceTotal: number, exchangeRate = 1): number {
  if (invoiceTotal <= 0) return 0;
  return r2(((allocated * invoiceSubtotal) / invoiceTotal) * exchangeRate);
}
