import { describe, expect, it } from "vitest";
import { priceLine, unitFactor, versionInForce, type EngineList, type EngineRule, type PricingContext, type PricingData } from "./pricing-engine";

const PCS = { id: "pcs", code: "PCS", baseUnitId: null, conversionFactor: 1 };
const DZN = { id: "dzn", code: "DZN", baseUnitId: "pcs", conversionFactor: 12 };
const SET = { id: "set", code: "SET", baseUnitId: null, conversionFactor: 1 };
const MTR = { id: "mtr", code: "MTR", baseUnitId: null, conversionFactor: 1 };
const YDS = { id: "yds", code: "YDS", baseUnitId: "mtr", conversionFactor: 0.9144 };
const POLO = { id: "polo", name: "Polo", categoryId: "tops", baseUomId: "pcs" };

let n = 0;
const entry = (unitPrice: number, minQuantity = 0, uomId = "pcs", productId = "polo") => ({ id: `e${n++}`, productId, uomId, minQuantity, unitPrice });
const version = (versionNumber: number, effectiveFrom: string, entries: ReturnType<typeof entry>[], extra: { status?: string; effectiveTo?: string | null } = {}) => ({
  id: `v${n++}`,
  versionNumber,
  status: extra.status ?? "APPROVED",
  effectiveFrom,
  effectiveTo: extra.effectiveTo ?? null,
  entries,
});
const list = (code: string, versions: ReturnType<typeof version>[], extra: Partial<EngineList> = {}): EngineList => ({
  id: code,
  code,
  name: `${code} list`,
  kind: "DEFAULT",
  customerId: null,
  priority: 0,
  isActive: true,
  versions,
  ...extra,
});
const rule = (code: string, extra: Partial<EngineRule> = {}): EngineRule => ({
  id: code,
  code,
  name: code,
  status: "ACTIVE",
  discountType: "PERCENT",
  value: 10,
  stacking: "EXCLUSIVE",
  priority: 0,
  productId: null,
  categoryId: null,
  customerId: null,
  priceListId: null,
  minQuantity: null,
  validFrom: "2026-01-01",
  validTo: null,
  ...extra,
});
const ctx = (extra: Partial<PricingContext> = {}): PricingContext => ({ date: "2026-11-01", customerId: "zen", maxRuleDiscountPercent: null, ...extra });
const data = (lists: EngineList[], rules: EngineRule[] = []): PricingData => ({ lists, rules, units: [PCS, DZN, SET, MTR, YDS], products: [POLO] });
const price = (lists: EngineList[], rules: EngineRule[] = [], q = 100, uomId: string | null = "pcs", c = ctx()) => priceLine({ productId: "polo", quantity: q, uomId }, c, data(lists, rules));

describe("units and versions", () => {
  it("converts through the unit master, exactly", () => {
    expect(unitFactor(DZN, PCS)?.toString()).toBe("12");
    expect(unitFactor(PCS, DZN)?.mul(12).toString()).toBe("1");
    expect(unitFactor(YDS, MTR)?.toString()).toBe("0.9144");
    expect(unitFactor(SET, PCS)).toBeNull();
  });

  it("uses the approved version with the latest start on or before the date", () => {
    const l = list("D", [version(1, "2026-01-01", []), version(2, "2026-10-15", []), version(3, "2026-12-01", []), version(4, "2026-10-20", [], { status: "DRAFT" })]);
    expect(versionInForce(l, "2026-11-01")).toMatchObject({ version: { versionNumber: 2 } });
    expect(versionInForce(l, "2026-12-01")).toMatchObject({ version: { versionNumber: 3 } });
    expect(versionInForce(l, "2025-12-31")).toMatchObject({ reason: expect.stringContaining("next one starts 01/01/2026") });
    expect(versionInForce(list("E", [version(1, "2026-01-01", [], { effectiveTo: "2026-06-30" })]), "2026-07-01")).toMatchObject({ reason: "version 1 ended on 30/06/2026" });
  });
});

describe("price source and precedence", () => {
  const def = list("DEF", [version(1, "2026-01-01", [entry(100)])]);
  const cust = list("ZEN", [version(1, "2026-01-01", [entry(90)])], { kind: "CUSTOMER", customerId: "zen" });

  it("customer list beats the default list; prospects get the default", () => {
    const r = price([def, cust]);
    expect(r).toMatchObject({ status: "PRICED", listUnitPrice: 90, netUnitPrice: 90, extendedAmount: 9000, source: { level: "CUSTOMER", priceListCode: "ZEN" } });
    expect(r.skipped).toContainEqual(expect.objectContaining({ code: "DEF", reason: "a customer price list applies" }));
    expect(price([def, cust], [], 100, "pcs", ctx({ customerId: null })).source?.priceListCode).toBe("DEF");
    expect(price([def, cust], [], 100, "pcs", ctx({ customerId: "other" })).source?.priceListCode).toBe("DEF");
  });

  it("higher priority wins inside a level; equal priority pricing the line is a conflict", () => {
    const low = list("LOW", [version(1, "2026-01-01", [entry(80)])], { priority: 1 });
    const high = list("HIGH", [version(1, "2026-01-01", [entry(95)])], { priority: 5 });
    expect(price([low, high]).source?.priceListCode).toBe("HIGH");
    const twin = list("TWIN", [version(1, "2026-01-01", [entry(70)])], { priority: 5 });
    expect(price([low, high, twin])).toMatchObject({ status: "CONFLICT", netUnitPrice: null, message: expect.stringContaining("HIGH and TWIN") });
  });

  it("skips inactive lists, lists not in force and lists without the Style; falls back to the next level", () => {
    const inactive = list("OFF", [version(1, "2026-01-01", [entry(1)])], { kind: "CUSTOMER", customerId: "zen", isActive: false, priority: 9 });
    const later = list("LATER", [version(1, "2026-12-01", [entry(2)])], { kind: "CUSTOMER", customerId: "zen", priority: 8 });
    const other = list("OTHER", [version(1, "2026-01-01", [entry(3, 0, "pcs", "tee")])], { kind: "CUSTOMER", customerId: "zen", priority: 7 });
    const r = price([def, inactive, later, other]);
    expect(r.source?.priceListCode).toBe("DEF");
    expect(r.skipped.map((s) => [s.code, s.reason])).toEqual([
      ["OFF", "list is inactive"],
      ["LATER", "no approved version in force on 01/11/2026 (next one starts 01/12/2026)"],
      ["OTHER", "v1: no price for Polo"],
    ]);
  });

  it("no list → no price, with a reason; bad requests are invalid", () => {
    expect(price([])).toMatchObject({ status: "NO_PRICE", netUnitPrice: null, message: expect.stringContaining("enter the price by hand") });
    expect(price([def], [], 0)).toMatchObject({ status: "INVALID" });
    expect(priceLine({ productId: "nope", quantity: 1, uomId: "pcs" }, ctx(), data([def]))).toMatchObject({ status: "INVALID" });
  });
});

describe("quantity breaks (all-units, inclusive)", () => {
  const tiers = list("DEF", [version(1, "2026-01-01", [entry(100, 1), entry(95, 100), entry(90, 500)])]);
  it.each([
    [1, 100],
    [99.999, 100],
    [100, 95],
    [499, 95],
    [500, 90],
    [10000, 90],
  ])("%s pcs → ₹%s each, for the whole quantity", (q, p) => {
    expect(price([tiers], [], q).netUnitPrice).toBe(p);
  });

  it("below the lowest break the list doesn't price the line (next level is tried)", () => {
    const cust = list("ZEN", [version(1, "2026-01-01", [entry(80, 1000)])], { kind: "CUSTOMER", customerId: "zen" });
    const r = price([tiers, cust], [], 999);
    expect(r.source?.priceListCode).toBe("DEF");
    expect(r.skipped[0]).toMatchObject({ code: "ZEN", reason: "v1: quantity 999 PCS is below the lowest break (1,000 PCS)" });
    expect(price([tiers, cust], [], 1000).source?.priceListCode).toBe("ZEN");
  });
});

describe("units", () => {
  it("converts a PCS price to a DZN line and checks the break in PCS", () => {
    const l = list("DEF", [version(1, "2026-01-01", [entry(100, 0), entry(90, 120)])]);
    const r = price([l], [], 10, "dzn"); // 120 pcs
    expect(r).toMatchObject({ listUnitPrice: 1080, netUnitPrice: 1080, extendedAmount: 10800, source: { entryUomCode: "PCS", conversionFactor: 12 } });
    expect(r.explanation[1]).toBe("1 DZN = 12 PCS → ₹1,080.00 per DZN");
  });

  it("prefers an entry in the line's own unit; never substitutes an unconvertible unit", () => {
    const l = list("DEF", [version(1, "2026-01-01", [entry(100, 0, "pcs"), entry(1000, 0, "dzn")])]);
    expect(price([l], [], 2, "dzn").netUnitPrice).toBe(1000);
    const sets = list("SETS", [version(1, "2026-01-01", [entry(300, 0, "set")])]);
    expect(price([sets], [], 5, "pcs")).toMatchObject({ status: "NO_PRICE" });
    expect(price([sets], [], 5, "pcs").skipped[0].reason).toContain("priced only in SET");
  });

  it("several convertible units: the Style's base unit wins, otherwise it's a conflict", () => {
    const tee = { id: "tee", name: "Tee", categoryId: null, baseUomId: "mtr" };
    const MTR2 = { id: "mtr2", code: "M2", baseUnitId: "mtr", conversionFactor: 1 };
    const l = list("DEF", [version(1, "2026-01-01", [entry(10, 0, "mtr", "tee"), entry(9, 0, "mtr2", "tee")])]);
    const d = { lists: [l], rules: [], units: [MTR, YDS, MTR2], products: [tee] };
    expect(priceLine({ productId: "tee", quantity: 1, uomId: "yds" }, ctx(), d)).toMatchObject({ netUnitPrice: 9.14, source: { entryUomCode: "MTR" } });
    const noBase = { ...tee, baseUomId: null };
    expect(priceLine({ productId: "tee", quantity: 1, uomId: "yds" }, ctx(), { ...d, products: [noBase] })).toMatchObject({ status: "CONFLICT" });
  });

  it("a line without a unit uses the Style's base unit", () => {
    expect(price([list("DEF", [version(1, "2026-01-01", [entry(100)])])], [], 3, null)).toMatchObject({ uomCode: "PCS", netUnitPrice: 100 });
  });
});

describe("discount rules", () => {
  const def = list("DEF", [version(1, "2026-01-01", [entry(100)])]);

  it("percent and per-unit amounts (per base unit, converted to the line unit)", () => {
    expect(price([def], [rule("P10")]).netUnitPrice).toBe(90);
    const amt = rule("A5", { discountType: "AMOUNT_PER_UNIT", value: 5 });
    expect(price([def], [amt]).netUnitPrice).toBe(95);
    const dz = price([def], [amt], 10, "dzn");
    expect(dz).toMatchObject({ listUnitPrice: 1200, netUnitPrice: 1140, ruleDiscountAmount: 60, rules: [{ code: "A5", discountPerUnit: 60 }] });
  });

  it("exclusive rules: the biggest one wins (tie → priority, then code)", () => {
    const r = price([def], [rule("SMALL", { value: 5 }), rule("BIG", { value: 12 }), rule("MID", { value: 8 })]);
    expect(r.rules.map((x) => x.code)).toEqual(["BIG"]);
    expect(r.skipped.filter((s) => s.kind === "RULE").map((s) => s.code).sort()).toEqual(["MID", "SMALL"]);
    const tie = price([def], [rule("B", { value: 5, priority: 1 }), rule("A", { value: 5 }), rule("C", { value: 5, priority: 1 })]);
    expect(tie.rules[0].code).toBe("B");
  });

  it("stackable rules apply in priority order on the reduced price", () => {
    const r = price([def], [rule("S10", { stacking: "STACKABLE", value: 10, priority: 2 }), rule("S5AMT", { stacking: "STACKABLE", discountType: "AMOUNT_PER_UNIT", value: 5, priority: 1 }), rule("S10B", { stacking: "STACKABLE", value: 10 })]);
    // 100 → −10 = 90 → −5 = 85 → −8.5 = 76.5
    expect(r).toMatchObject({ netUnitPrice: 76.5, ruleDiscountAmount: 23.5 });
    expect(r.rules.map((x) => [x.code, x.discountPerUnit])).toEqual([["S10", 10], ["S5AMT", 5], ["S10B", 8.5]]);
  });

  it("the line gets the larger of: best exclusive rule alone, or all stackables (tie → exclusive)", () => {
    const stack = [rule("S10", { stacking: "STACKABLE", value: 10 }), rule("S5", { stacking: "STACKABLE", value: 5 })]; // 14.5 total
    expect(price([def], [...stack, rule("X12", { value: 12 })]).rules.map((r) => r.code)).toEqual(["S10", "S5"]);
    expect(price([def], [...stack, rule("X15", { value: 15 })]).rules.map((r) => r.code)).toEqual(["X15"]);
    expect(price([def], [...stack, rule("X145", { value: 14.5 })]).rules.map((r) => r.code)).toEqual(["X145"]);
  });

  it("conditions: style, category, customer, price list, minimum quantity (base unit), dates; never below zero", () => {
    const rules = [
      rule("OTHERSTYLE", { productId: "tee", value: 50 }),
      rule("OTHERCAT", { categoryId: "bottoms", value: 50 }),
      rule("OTHERCUST", { customerId: "acme", value: 50 }),
      rule("OTHERLIST", { priceListId: "ZEN", value: 50 }),
      rule("EXPIRED", { validTo: "2026-10-31", value: 50 }),
      rule("FUTURE", { validFrom: "2026-11-02", value: 50 }),
      rule("BULK", { minQuantity: 1200, value: 50 }),
      rule("INACTIVE", { status: "INACTIVE", value: 50 }),
    ];
    const r = price([def], rules, 100);
    expect(r).toMatchObject({ netUnitPrice: 100, rules: [] });
    expect(r.skipped.map((s) => s.code).sort()).toEqual(["BULK", "EXPIRED", "FUTURE", "OTHERLIST"]); // unrelated rules aren't listed
    expect(price([def], rules, 100, "dzn").rules.map((x) => x.code)).toEqual(["BULK"]); // 1,200 pcs
    expect(price([def], [rule("ALL", { discountType: "AMOUNT_PER_UNIT", value: 150 })]).netUnitPrice).toBe(0);
  });

  it("respects the company cap on rule discounts", () => {
    const r = price([def], [rule("S30", { stacking: "STACKABLE", value: 30 }), rule("S20", { stacking: "STACKABLE", value: 20 })], 100, "pcs", ctx({ maxRuleDiscountPercent: 25 }));
    expect(r).toMatchObject({ netUnitPrice: 75, ruleDiscountCapped: true });
    expect(r.explanation).toContain("Rule discount capped at 25% of the list price");
  });

  it("rounds once, half-up, at the end", () => {
    const l = list("DEF", [version(1, "2026-01-01", [entry(99.99)])]);
    // 99.99 × 0.97 = 96.9903 → 96.99 ; 99.99 × 0.995 = 99.49005 → 99.49 ; 10.01 × 0.5 = 5.005 → 5.01
    expect(price([l], [rule("P3", { value: 3 })]).netUnitPrice).toBe(96.99);
    expect(price([l], [rule("P05", { value: 0.5 })]).netUnitPrice).toBe(99.49);
    const half = list("DEF", [version(1, "2026-01-01", [entry(10.01)])]);
    expect(price([half], [rule("P50", { value: 50 })]).netUnitPrice).toBe(5.01);
    // 1 YDS of a ₹10/MTR price = ₹9.144 → list ₹9.14
    const tee = { id: "tee", name: "Tee", categoryId: null, baseUomId: "mtr" };
    expect(priceLine({ productId: "tee", quantity: 1, uomId: "yds" }, ctx(), { lists: [list("D", [version(1, "2026-01-01", [entry(10, 0, "mtr", "tee")])])], rules: [], units: [MTR, YDS], products: [tee] }).listUnitPrice).toBe(9.14);
  });

  it("is deterministic and explains itself", () => {
    const rules = [rule("S10", { stacking: "STACKABLE" }), rule("X5", { value: 5 })];
    const a = price([def], rules);
    expect(price([def], [...rules].reverse())).toEqual(a);
    expect(a.explanation).toEqual([
      "Default price list DEF (DEF list) v1, in force from 01/01/2026: ₹100.00 per PCS",
      "Rule S10 (10% off, stackable): −₹10.00 per PCS",
      "Net price ₹90.00 per PCS",
    ]);
  });
});
