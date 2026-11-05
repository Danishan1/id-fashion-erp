import { Prisma } from "@prisma/client";

/**
 * Pricing engine (Sales & Marketing Phase 03, 2026-10-29) — pure and
 * deterministic: the same lists, rules and request always give the same
 * result. No database access here; `pricing.service.ts` loads the data.
 * Rules and their order: docs/sales-marketing/PHASE_03_PRICING.md §3–§5.
 *
 * Money uses decimal arithmetic (Prisma.Decimal = decimal.js). Nothing is
 * rounded until the very end: the net unit price is rounded half-up to the
 * paisa once; the list price shown is the same unrounded price rounded the
 * same way.
 */

const Dec = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new Dec(0);
const HUNDRED = new Dec(100);
const money = (d: Dec) => d.toDecimalPlaces(2, Dec.ROUND_HALF_UP);

// ── Inputs ───────────────────────────────────────────────────────

export interface EngineUnit {
  id: string;
  code: string;
  baseUnitId: string | null;
  conversionFactor: string | number;
}

export interface EngineEntry {
  id: string;
  productId: string;
  uomId: string;
  minQuantity: string | number;
  unitPrice: string | number;
}

export interface EngineVersion {
  id: string;
  versionNumber: number;
  status: string;
  /** YYYY-MM-DD */
  effectiveFrom: string;
  effectiveTo: string | null;
  entries: EngineEntry[];
}

export interface EngineList {
  id: string;
  code: string;
  name: string;
  kind: "DEFAULT" | "CUSTOMER";
  customerId: string | null;
  priority: number;
  isActive: boolean;
  versions: EngineVersion[];
}

export interface EngineRule {
  id: string;
  code: string;
  name: string;
  status: string;
  discountType: "PERCENT" | "AMOUNT_PER_UNIT";
  value: string | number;
  stacking: "EXCLUSIVE" | "STACKABLE";
  priority: number;
  productId: string | null;
  categoryId: string | null;
  customerId: string | null;
  priceListId: string | null;
  minQuantity: string | number | null;
  validFrom: string;
  validTo: string | null;
}

export interface EngineProduct {
  id: string;
  name: string;
  categoryId: string | null;
  baseUomId: string | null;
}

export interface PricingContext {
  /** YYYY-MM-DD — the transaction (quotation) date. */
  date: string;
  /** Null for a prospect: only default lists apply. */
  customerId: string | null;
  /** Company cap on the total rule discount, % of the list price. Null = none. */
  maxRuleDiscountPercent: number | null;
}

export interface PricingData {
  lists: EngineList[];
  rules: EngineRule[];
  units: EngineUnit[];
  products: EngineProduct[];
}

export interface PricingRequestLine {
  productId: string;
  quantity: number | string;
  /** Null = the Style's base unit. */
  uomId: string | null;
}

// ── Output ───────────────────────────────────────────────────────

export type PricingStatus = "PRICED" | "NO_PRICE" | "CONFLICT" | "INVALID";

export interface PricingSource {
  level: "CUSTOMER" | "DEFAULT";
  priceListId: string;
  priceListCode: string;
  priceListName: string;
  versionId: string;
  versionNumber: number;
  versionEffectiveFrom: string;
  entryId: string;
  entryUomId: string;
  entryUomCode: string;
  entryUnitPrice: number;
  minQuantity: number;
  /** Entry units in one line unit (1 = same unit). */
  conversionFactor: number;
}

export interface AppliedRule {
  id: string;
  code: string;
  name: string;
  discountType: "PERCENT" | "AMOUNT_PER_UNIT";
  value: number;
  stacking: "EXCLUSIVE" | "STACKABLE";
  /** Discount per line unit, 4 dp (informational; only the net price is rounded to the paisa). */
  discountPerUnit: number;
}

export interface SkippedItem {
  kind: "PRICE_LIST" | "RULE";
  id: string;
  code: string;
  reason: string;
}

export interface PricingResult {
  productId: string;
  quantity: number;
  uomId: string | null;
  uomCode: string | null;
  status: PricingStatus;
  source: PricingSource | null;
  /** List price per line unit, rounded to the paisa. */
  listUnitPrice: number | null;
  rules: AppliedRule[];
  /** listUnitPrice − netUnitPrice. */
  ruleDiscountAmount: number | null;
  ruleDiscountCapped: boolean;
  netUnitPrice: number | null;
  /** quantity × net unit price, rounded (before any manual discount and GST). */
  extendedAmount: number | null;
  explanation: string[];
  skipped: SkippedItem[];
  message: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────

const inr = (v: Dec | number) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (v: Dec | number) => Number(v).toLocaleString("en-IN", { maximumFractionDigits: 3 });
const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * How many `to` units make one `from` unit, through the unit master (depth-1,
 * same rule as src/lib/uom-conversion.ts), or null when there is no fixed
 * conversion. Decimal, so 1 DZN → 12 PCS is exact.
 */
export function unitFactor(from: EngineUnit, to: EngineUnit): Dec | null {
  if (from.id === to.id) return new Dec(1);
  const ff = new Dec(from.conversionFactor);
  const tf = new Dec(to.conversionFactor);
  if (from.baseUnitId === to.id) return ff;
  if (to.baseUnitId === from.id) return new Dec(1).div(tf);
  if (from.baseUnitId && from.baseUnitId === to.baseUnitId) return ff.div(tf);
  return null;
}

/** The approved version in force on `date`, or why there is none. */
export function versionInForce(list: EngineList, date: string): { version: EngineVersion } | { reason: string } {
  const started = list.versions
    .filter((v) => v.status === "APPROVED" && v.effectiveFrom <= date)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : b.versionNumber - a.versionNumber));
  const v = started[0];
  if (!v) {
    const next = list.versions.filter((x) => x.status === "APPROVED" && x.effectiveFrom > date).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0];
    return { reason: next ? `no approved version in force on ${day(date)} (next one starts ${day(next.effectiveFrom)})` : `no approved version in force on ${day(date)}` };
  }
  if (v.effectiveTo && v.effectiveTo < date) return { reason: `version ${v.versionNumber} ended on ${day(v.effectiveTo)}` };
  return { version: v };
}

type EntryPick =
  | { ok: true; entry: EngineEntry; unit: EngineUnit; factor: Dec; price: Dec }
  | { ok: false; conflict: boolean; reason: string };

/**
 * The entry of one version that prices this line: the line's own unit first,
 * else one convertible unit (the Style's base unit wins if several), then the
 * all-units break with the highest from-quantity <= the quantity in that unit.
 */
export function pickEntry(version: EngineVersion, product: EngineProduct, lineUnit: EngineUnit, quantity: Dec, units: Map<string, EngineUnit>): EntryPick {
  const entries = version.entries.filter((e) => e.productId === product.id);
  if (!entries.length) return { ok: false, conflict: false, reason: `no price for ${product.name}` };
  const byUnit = new Map<string, EngineEntry[]>();
  for (const e of entries) byUnit.set(e.uomId, [...(byUnit.get(e.uomId) ?? []), e]);

  let unitId: string;
  let factor: Dec;
  if (byUnit.has(lineUnit.id)) {
    unitId = lineUnit.id;
    factor = new Dec(1);
  } else {
    const convertible = [...byUnit.keys()]
      .map((id) => ({ id, unit: units.get(id), f: units.get(id) ? unitFactor(lineUnit, units.get(id)!) : null }))
      .filter((x): x is { id: string; unit: EngineUnit; f: Dec } => Boolean(x.unit && x.f));
    if (!convertible.length) {
      const codes = [...byUnit.keys()].map((id) => units.get(id)?.code ?? "?").join(", ");
      return { ok: false, conflict: false, reason: `priced only in ${codes}, which can't be converted to ${lineUnit.code}` };
    }
    const chosen = convertible.length === 1 ? convertible[0] : convertible.find((c) => c.id === product.baseUomId);
    if (!chosen) return { ok: false, conflict: true, reason: `priced in several units (${convertible.map((c) => c.unit.code).join(", ")}) — can't tell which applies to ${lineUnit.code}` };
    unitId = chosen.id;
    factor = chosen.f;
  }
  const unit = units.get(unitId)!;
  const inUnit = quantity.mul(factor);
  const breaks = byUnit.get(unitId)!.slice().sort((a, b) => new Dec(b.minQuantity).cmp(new Dec(a.minQuantity)));
  const entry = breaks.find((e) => inUnit.gte(new Dec(e.minQuantity)));
  if (!entry) {
    const lowest = breaks[breaks.length - 1];
    return { ok: false, conflict: false, reason: `quantity ${qty(inUnit)} ${unit.code} is below the lowest break (${qty(new Dec(lowest.minQuantity))} ${unit.code})` };
  }
  return { ok: true, entry, unit, factor, price: new Dec(entry.unitPrice).mul(factor) };
}

interface Candidate {
  list: EngineList;
  version: EngineVersion;
  pick: Extract<EntryPick, { ok: true }>;
}

function ruleLabel(r: EngineRule) {
  const v = Number(r.value);
  return r.discountType === "PERCENT" ? `${v}% off` : `${inr(v)} off per base unit`;
}

// ── Main ─────────────────────────────────────────────────────────

/** Prices one line. */
export function priceLine(req: PricingRequestLine, ctx: PricingContext, data: PricingData): PricingResult {
  const units = new Map(data.units.map((u) => [u.id, u]));
  const product = data.products.find((p) => p.id === req.productId);
  const quantity = new Dec(req.quantity || 0);
  const lineUnitId = req.uomId || product?.baseUomId || null;
  const lineUnit = lineUnitId ? (units.get(lineUnitId) ?? null) : null;
  const base: PricingResult = {
    productId: req.productId,
    quantity: Number(quantity),
    uomId: lineUnitId,
    uomCode: lineUnit?.code ?? null,
    status: "NO_PRICE",
    source: null,
    listUnitPrice: null,
    rules: [],
    ruleDiscountAmount: null,
    ruleDiscountCapped: false,
    netUnitPrice: null,
    extendedAmount: null,
    explanation: [],
    skipped: [],
    message: null,
  };
  if (!product) return { ...base, status: "INVALID", message: "Style not found." };
  if (!quantity.gt(0)) return { ...base, status: "INVALID", message: "Enter a quantity above 0." };
  if (!lineUnit) return { ...base, status: "INVALID", message: "Choose a unit (the Style has no base unit)." };

  // 1. Price source: customer lists, then default lists; by priority.
  const skipped: SkippedItem[] = [];
  let chosen: Candidate | null = null;
  let level: "CUSTOMER" | "DEFAULT" | null = null;
  for (const lvl of ["CUSTOMER", "DEFAULT"] as const) {
    const lists = data.lists
      .filter((l) => l.kind === lvl && (lvl === "DEFAULT" || (ctx.customerId && l.customerId === ctx.customerId)))
      .sort((a, b) => b.priority - a.priority || a.code.localeCompare(b.code));
    const priced: Candidate[] = [];
    for (const list of lists) {
      if (!list.isActive) {
        skipped.push({ kind: "PRICE_LIST", id: list.id, code: list.code, reason: "list is inactive" });
        continue;
      }
      const inForce = versionInForce(list, ctx.date);
      if ("reason" in inForce) {
        skipped.push({ kind: "PRICE_LIST", id: list.id, code: list.code, reason: inForce.reason });
        continue;
      }
      const pick = pickEntry(inForce.version, product, lineUnit, quantity, units);
      if (!pick.ok) {
        if (pick.conflict) return { ...base, status: "CONFLICT", skipped, message: `${list.code} v${inForce.version.versionNumber}: ${pick.reason}.` };
        skipped.push({ kind: "PRICE_LIST", id: list.id, code: list.code, reason: `v${inForce.version.versionNumber}: ${pick.reason}` });
        continue;
      }
      priced.push({ list, version: inForce.version, pick });
    }
    if (priced.length) {
      const top = priced[0].list.priority;
      const tied = priced.filter((c) => c.list.priority === top);
      if (tied.length > 1) {
        return { ...base, status: "CONFLICT", skipped, message: `Price lists ${tied.map((c) => c.list.code).join(" and ")} both price this line at the same priority (${top}). Give one of them a different priority.` };
      }
      chosen = priced[0];
      level = lvl;
      for (const c of priced.slice(1)) skipped.push({ kind: "PRICE_LIST", id: c.list.id, code: c.list.code, reason: `lower priority than ${chosen.list.code}` });
      if (lvl === "CUSTOMER") {
        for (const l of data.lists.filter((x) => x.kind === "DEFAULT")) skipped.push({ kind: "PRICE_LIST", id: l.id, code: l.code, reason: "a customer price list applies" });
      }
      break;
    }
  }
  if (!chosen || !level) {
    return { ...base, skipped, message: `No price list prices ${product.name} for ${qty(quantity)} ${lineUnit.code} on ${day(ctx.date)} — enter the price by hand.` };
  }

  const { list, version, pick } = chosen;
  const P = pick.price; // list price per line unit, unrounded
  const explanation: string[] = [
    `${level === "CUSTOMER" ? "Customer" : "Default"} price list ${list.code} (${list.name}) v${version.versionNumber}, in force from ${day(version.effectiveFrom)}: ${inr(new Dec(pick.entry.unitPrice))} per ${pick.unit.code}` +
      (new Dec(pick.entry.minQuantity).gt(0) ? ` for ${qty(new Dec(pick.entry.minQuantity))}+ ${pick.unit.code}` : ""),
  ];
  if (pick.unit.id !== lineUnit.id) explanation.push(`1 ${lineUnit.code} = ${qty(pick.factor)} ${pick.unit.code} → ${inr(P)} per ${lineUnit.code}`);

  // 2. Discount rules.
  const baseUnit = product.baseUomId ? units.get(product.baseUomId) : undefined;
  const fBase = baseUnit ? unitFactor(lineUnit, baseUnit) : null; // base units in one line unit
  const eligible: { rule: EngineRule; perUnit: Dec }[] = [];
  for (const r of data.rules) {
    if (r.status !== "ACTIVE") continue;
    const scoped = (!r.productId || r.productId === product.id) && (!r.categoryId || r.categoryId === product.categoryId) && (!r.customerId || r.customerId === ctx.customerId);
    if (!scoped) continue; // not about this line at all — not reported
    const skip = (reason: string) => skipped.push({ kind: "RULE", id: r.id, code: r.code, reason });
    if (r.validFrom > ctx.date || (r.validTo && r.validTo < ctx.date)) {
      skip(`not valid on ${day(ctx.date)}`);
      continue;
    }
    if (r.priceListId && r.priceListId !== list.id) {
      skip("only for another price list");
      continue;
    }
    const needsBase = r.discountType === "AMOUNT_PER_UNIT" || r.minQuantity !== null;
    if (needsBase && !fBase) {
      skip(`${lineUnit.code} can't be converted to the Style's base unit`);
      continue;
    }
    if (r.minQuantity !== null && quantity.mul(fBase!).lt(new Dec(r.minQuantity))) {
      skip(`needs at least ${qty(new Dec(r.minQuantity))} ${baseUnit!.code}`);
      continue;
    }
    eligible.push({ rule: r, perUnit: r.discountType === "PERCENT" ? P.mul(new Dec(r.value)).div(HUNDRED) : new Dec(r.value).mul(fBase!) });
  }
  const byPriority = (a: { rule: EngineRule }, b: { rule: EngineRule }) => b.rule.priority - a.rule.priority || a.rule.code.localeCompare(b.rule.code);

  // Best exclusive rule alone.
  const exclusive = eligible.filter((e) => e.rule.stacking === "EXCLUSIVE").map((e) => ({ ...e, perUnit: Dec.min(e.perUnit, P) }));
  exclusive.sort((a, b) => b.perUnit.cmp(a.perUnit) || byPriority(a, b));
  const bestExclusive = exclusive[0] ?? null;

  // Stackable chain on the running price.
  const chain: { rule: EngineRule; perUnit: Dec }[] = [];
  let running = P;
  for (const e of eligible.filter((x) => x.rule.stacking === "STACKABLE").sort(byPriority)) {
    const d = Dec.min(e.rule.discountType === "PERCENT" ? running.mul(new Dec(e.rule.value)).div(HUNDRED) : e.perUnit, running);
    running = running.sub(d);
    chain.push({ rule: e.rule, perUnit: d });
  }
  const chainTotal = P.sub(running);

  let applied: { rule: EngineRule; perUnit: Dec }[] = [];
  if (bestExclusive && bestExclusive.perUnit.gte(chainTotal)) {
    applied = [bestExclusive];
    for (const e of exclusive.slice(1)) skipped.push({ kind: "RULE", id: e.rule.id, code: e.rule.code, reason: `${bestExclusive.rule.code} gives a bigger discount` });
    for (const e of chain) skipped.push({ kind: "RULE", id: e.rule.id, code: e.rule.code, reason: `exclusive rule ${bestExclusive.rule.code} gives a bigger discount than the stackable rules together` });
  } else if (chain.length) {
    applied = chain;
    for (const e of exclusive) skipped.push({ kind: "RULE", id: e.rule.id, code: e.rule.code, reason: "the stackable rules together give a bigger discount" });
  }

  let discount = applied.reduce((s, a) => s.add(a.perUnit), ZERO);
  let capped = false;
  if (ctx.maxRuleDiscountPercent !== null && ctx.maxRuleDiscountPercent !== undefined) {
    const cap = P.mul(new Dec(ctx.maxRuleDiscountPercent)).div(HUNDRED);
    if (discount.gt(cap)) {
      discount = cap;
      capped = true;
    }
  }
  const listUnitPrice = money(P);
  let net = money(Dec.max(P.sub(discount), ZERO));
  if (net.gt(listUnitPrice)) net = listUnitPrice;
  for (const a of applied) explanation.push(`Rule ${a.rule.code} (${ruleLabel(a.rule)}, ${a.rule.stacking.toLowerCase()}): −${inr(a.perUnit)} per ${lineUnit.code}`);
  if (capped) explanation.push(`Rule discount capped at ${ctx.maxRuleDiscountPercent}% of the list price`);
  explanation.push(`Net price ${inr(net)} per ${lineUnit.code}`);

  return {
    ...base,
    status: "PRICED",
    source: {
      level,
      priceListId: list.id,
      priceListCode: list.code,
      priceListName: list.name,
      versionId: version.id,
      versionNumber: version.versionNumber,
      versionEffectiveFrom: version.effectiveFrom,
      entryId: pick.entry.id,
      entryUomId: pick.unit.id,
      entryUomCode: pick.unit.code,
      entryUnitPrice: Number(pick.entry.unitPrice),
      minQuantity: Number(pick.entry.minQuantity),
      conversionFactor: Number(pick.factor.toDecimalPlaces(6)),
    },
    listUnitPrice: Number(listUnitPrice),
    rules: applied.map((a) => ({
      id: a.rule.id,
      code: a.rule.code,
      name: a.rule.name,
      discountType: a.rule.discountType,
      value: Number(a.rule.value),
      stacking: a.rule.stacking,
      discountPerUnit: Number(a.perUnit.toDecimalPlaces(4, Dec.ROUND_HALF_UP)),
    })),
    ruleDiscountAmount: Number(listUnitPrice.sub(net)),
    ruleDiscountCapped: capped,
    netUnitPrice: Number(net),
    extendedAmount: Number(money(net.mul(quantity))),
    explanation,
    skipped,
  };
}
