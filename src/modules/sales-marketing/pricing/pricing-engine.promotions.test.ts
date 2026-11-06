import { describe, expect, it } from "vitest";
import { priceLine, type EngineList, type EngineRule, type PricingContext, type PricingData } from "./pricing-engine";

/** Phase 12: promotions are extra engine inputs — same stacking, cap and rounding as discount rules. */

const PCS = { id: "pcs", code: "PCS", baseUnitId: null, conversionFactor: 1 };
const DZN = { id: "dzn", code: "DZN", baseUnitId: "pcs", conversionFactor: 12 };
const POLO = { id: "polo", name: "Polo", categoryId: "tops", baseUomId: "pcs" };
const TEE = { id: "tee", name: "Tee", categoryId: "tops", baseUomId: "pcs" };

const LIST: EngineList = {
  id: "std",
  code: "STD",
  name: "Standard",
  kind: "DEFAULT",
  customerId: null,
  priority: 0,
  isActive: true,
  versions: [{ id: "v1", versionNumber: 1, status: "APPROVED", effectiveFrom: "2026-01-01", effectiveTo: null, entries: [{ id: "e1", productId: "polo", uomId: "pcs", minQuantity: 0, unitPrice: 200 }, { id: "e2", productId: "tee", uomId: "pcs", minQuantity: 0, unitPrice: 100 }] }],
};

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
const promo = (code: string, extra: Partial<EngineRule> = {}) => rule(code, { id: `ver-${code}`, promotion: { id: `p-${code}`, versionId: `ver-${code}`, versionNumber: 2, code }, ...extra });
const ctx = (extra: Partial<PricingContext> = {}): PricingContext => ({ date: "2026-11-10", customerId: "zen", maxRuleDiscountPercent: null, ...extra });
const data = (rules: EngineRule[]): PricingData => ({ lists: [LIST], rules, units: [PCS, DZN], products: [POLO, TEE] });
const price = (rules: EngineRule[], productId = "polo", quantity = 10, c = ctx(), uomId = "pcs") => priceLine({ productId, quantity, uomId }, c, data(rules));

describe("promotions in the pricing engine", () => {
  it("applies and records the promotion version on the applied discount", () => {
    const r = price([promo("DIWALI", { value: 15 })]);
    expect(r.netUnitPrice).toBe(170);
    expect(r.rules).toEqual([expect.objectContaining({ code: "DIWALI", promotionId: "p-DIWALI", promotionVersionId: "ver-DIWALI", promotionVersionNumber: 2, discountPerUnit: 30 })]);
    expect(r.explanation.join("\n")).toContain("Promotion DIWALI v2");
  });

  it("an exclusive promotion and an exclusive rule: the bigger discount wins, the other is reported", () => {
    const r = price([rule("R5", { value: 5 }), promo("BIG", { value: 20 })]);
    expect(r.netUnitPrice).toBe(160);
    expect(r.rules.map((x) => x.code)).toEqual(["BIG"]);
    expect(r.skipped).toContainEqual(expect.objectContaining({ kind: "RULE", code: "R5", reason: expect.stringContaining("BIG") }));
  });

  it("stackable promotions chain on the running price with stackable rules", () => {
    const r = price([rule("R10", { stacking: "STACKABLE" }), promo("P10", { stacking: "STACKABLE" })]);
    // 200 → −20 → 180 → −18 → 162
    expect(r.netUnitPrice).toBe(162);
    expect(r.rules.map((x) => x.code).sort()).toEqual(["P10", "R10"]);
  });

  it("Style list, excluded Styles and price lists scope a promotion", () => {
    expect(price([promo("POLOONLY", { productIds: ["polo"] })], "tee").rules).toEqual([]);
    expect(price([promo("POLOONLY", { productIds: ["polo"] })], "polo").rules).toHaveLength(1);
    const ex = price([promo("NOPOLO", { excludedProductIds: ["polo"] })], "polo");
    expect(ex.rules).toEqual([]);
    expect(ex.skipped).toContainEqual(expect.objectContaining({ kind: "PROMOTION", code: "NOPOLO", reason: "Polo is excluded" }));
    expect(price([promo("OTHERLIST", { priceListIds: ["vip"] })]).skipped).toContainEqual(expect.objectContaining({ code: "OTHERLIST", reason: "only for another price list" }));
    expect(price([promo("TOPS", { categoryIds: ["tops"] })], "tee").rules).toHaveLength(1);
    expect(price([promo("BOTTOMS", { categoryIds: ["bottoms"] })], "tee").rules).toEqual([]);
  });

  it("minimum line value is checked at list price", () => {
    expect(price([promo("MIN", { minLineValue: 2500 })], "polo", 10).skipped).toContainEqual(expect.objectContaining({ code: "MIN", reason: expect.stringContaining("₹2,500.00") }));
    expect(price([promo("MIN", { minLineValue: 2500 })], "polo", 13).rules).toHaveLength(1);
  });

  it("minimum quantity is in base units (1 DZN = 12 PCS)", () => {
    const r = price([promo("DOZ", { minQuantity: 12, discountType: "AMOUNT_PER_UNIT", value: 5 })], "polo", 1, ctx(), "dzn");
    // 2400 per DZN, ₹5 per PCS → ₹60 per DZN
    expect(r.netUnitPrice).toBe(2340);
  });

  it("dates are compared with the quotation date", () => {
    expect(price([promo("LATE", { validFrom: "2026-12-01" })]).skipped).toContainEqual(expect.objectContaining({ code: "LATE", reason: expect.stringContaining("not valid") }));
  });

  it("under the company cap each applied discount is scaled so they still add up to the capped total", () => {
    const r = price([rule("R20", { stacking: "STACKABLE", value: 20 }), promo("P20", { stacking: "STACKABLE", value: 20 })], "polo", 10, ctx({ maxRuleDiscountPercent: 25 }));
    // uncapped: 40 + 32 = 72; cap 25% of 200 = 50
    expect(r.netUnitPrice).toBe(150);
    expect(r.ruleDiscountCapped).toBe(true);
    const sum = r.rules.reduce((s, x) => s + x.discountPerUnit, 0);
    expect(sum).toBeCloseTo(50, 3);
    // 40 and 32 (whichever chained first) scaled by 50/72.
    const parts = r.rules.map((x) => x.discountPerUnit).sort((a, b) => a - b);
    expect(parts[0]).toBeCloseTo((32 * 50) / 72, 3);
    expect(parts[1]).toBeCloseTo((40 * 50) / 72, 3);
  });
});
