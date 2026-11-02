/**
 * Pricing (Sales & Marketing Phase 03) against a real, migrated + seeded
 * Postgres database. Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE
 * database.
 *
 * Permissions are mocked: "manager" can approve (not their own work — the
 * self-approval rule is honoured like PermissionService), "rep" can do
 * everything except approve; "noOverride" lacks sales_quotations.override.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { alignEnquiryCounter } from "../integration-test-helpers";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const approvers = new Set<string>();
const noOverride = new Set<string>();
const can = async (userId: string, module: string, action: string, ctx?: { createdBy?: string }) => {
  if (action === "approve" || action === "reject") return approvers.has(userId) && ctx?.createdBy !== userId;
  if (action === "override") return !noOverride.has(userId);
  if (action === "view_all") return true;
  return true;
};
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(can),
    assert: vi.fn(async (userId: string, module: string, action: string, ctx?: { createdBy?: string }) => {
      if (!(await can(userId, module, action, ctx))) throw Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" });
    }),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("Pricing (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const lists = await import("./price-list.service");
  const rules = await import("./discount-rule.service");
  const pricing = await import("./pricing.service");
  const quotes = await import("@/modules/sales-marketing/quotations/quotation.service");
  const life = await import("@/modules/sales-marketing/quotations/quotation-lifecycle.service");
  const settings = await import("@/modules/sales-marketing/settings/sales-marketing-settings.service");

  const run = `p${Date.now().toString(36)}`;
  let rep: Actor, manager: Actor, rep2: Actor, outsider: Actor;
  let customer: string, otherCustomer: string, style: string, style2: string, pcs: string, dzn: string, gst5: string, category: string;
  const today = new Date().toISOString().slice(0, 10);
  const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const expectCode = (p: Promise<unknown>, code: string) =>
    code === "VALIDATION_ERROR"
      ? p.then(
          () => expect.unreachable("expected a validation error"),
          (e: { name?: string; code?: string }) => expect(e.name === "ZodError" || e.code === "VALIDATION_ERROR").toBe(true)
        )
      : expect(p).rejects.toMatchObject({ code });
  let seq = 0;
  const code = (p: string) => `${p}-${run}-${seq++}`.toUpperCase();

  /** Creates, submits (rep) and approves (manager) a list; returns its id. */
  const approvedList = async (body: Record<string, unknown>) => {
    const l = await lists.createPriceList(rep, { code: code("PL"), name: "List", kind: "DEFAULT", priority: 0, effectiveFrom: today, entries: [], ...body });
    const v = await prisma.priceListVersion.findFirstOrThrow({ where: { priceListId: l!.id } });
    await lists.priceVersionAction(rep, l!.id, v.id, "submit", {});
    await lists.priceVersionAction(manager, l!.id, v.id, "approve", {});
    return l!.id;
  };
  const activeRule = async (body: Record<string, unknown>) => {
    const r = await rules.createDiscountRule(rep, { code: code("R"), name: "Rule", discountType: "PERCENT", value: 10, stacking: "EXCLUSIVE", validFrom: today, ...body });
    await rules.discountRuleAction(rep, r.id, "submit", {});
    await rules.discountRuleAction(manager, r.id, "approve", {});
    return r.id;
  };
  const quoteBody = (lines: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({
    customerId: customer,
    title: `${run} pricing`,
    quotationDate: today,
    validUntil: plusDays(30),
    lines,
    ...extra,
  });
  const line = (extra: Record<string, unknown> = {}) => ({ productId: style, description: "Polo", quantity: 100, uomId: pcs, unitPrice: 0, taxRateId: gst5, priceMode: "AUTO", ...extra });
  const ownLists = (companyId: string) => prisma.priceList.updateMany({ where: { companyId, code: { not: { contains: run.toUpperCase() } } }, data: { isActive: false } });

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    await alignEnquiryCounter(prisma, company.id);
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@pr-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [r, m, r2] = await Promise.all([mk("rep"), mk("manager"), mk("rep2")]);
    const actor = (id: string) => ({ companyId: company.id, userId: id, branchId: null });
    [rep, manager, rep2] = [actor(r.id), actor(m.id), actor(r2.id)];
    approvers.add(m.id);
    noOverride.add(r2.id);
    // Another company for tenant isolation.
    const other = await prisma.company.create({ data: { name: `Other ${run}`, baseCurrencyCode: "INR" } });
    outsider = { companyId: other.id, userId: r.id, branchId: null };
    customer = (await prisma.customer.create({ data: { companyId: company.id, code: `PC-${run}`, name: `Pricing Customer ${run}` } })).id;
    otherCustomer = (await prisma.customer.create({ data: { companyId: company.id, code: `PC2-${run}`, name: `Other ${run}` } })).id;
    pcs = (await prisma.unitOfMeasure.findFirstOrThrow({ where: { code: "PCS" } })).id;
    dzn = (await prisma.unitOfMeasure.findFirstOrThrow({ where: { code: "DZN", baseUnitId: pcs } })).id;
    category = (await prisma.category.create({ data: { companyId: company.id, code: `CAT-${run}`, name: `Tops ${run}` } })).id;
    style = (await prisma.product.create({ data: { companyId: company.id, styleCode: `PP-${run}`, styleName: `Polo ${run}`, itemType: "STYLE", baseUomId: pcs, categoryId: category } })).id;
    style2 = (await prisma.product.create({ data: { companyId: company.id, styleCode: `PH-${run}`, styleName: `Hood ${run}`, itemType: "STYLE", baseUomId: pcs } })).id;
    const taxType = await prisma.taxType.create({ data: { companyId: company.id, code: `GSTP-${run}`, name: "GST" } });
    gst5 = (await prisma.taxRate.create({ data: { companyId: company.id, taxTypeId: taxType.id, name: `GST 5% ${run}`, ratePercentage: "5", effectiveFrom: new Date("2020-01-01") } })).id;
    // Lists / rules from other test runs must not interfere.
    await ownLists(company.id);
    await prisma.discountRule.updateMany({ where: { companyId: company.id, status: "ACTIVE" }, data: { status: "INACTIVE" } });
  });

  afterAll(async () => {
    await settings.updateSalesMarketingSettings(manager, { quotationApprovalMaxDiscountPercent: 10, quotationApprovalMaxTotal: 500000, quotationDefaultValidityDays: 30, pricingMaxRuleDiscountPercent: null });
    await prisma.$disconnect();
  });

  it("price list lifecycle: draft → submit → approve by someone else; frozen; new version; scheduled change; withdraw", async () => {
    const l = await lists.createPriceList(rep, { code: code("DEF"), name: "Default", kind: "DEFAULT", priority: 1, effectiveFrom: today, entries: [{ productId: style, uomId: pcs, minQuantity: 0, unitPrice: 100 }, { productId: style, uomId: pcs, minQuantity: 500, unitPrice: 90 }] });
    const v1 = await prisma.priceListVersion.findFirstOrThrow({ where: { priceListId: l!.id } });
    // Duplicate break, raw material, bad dates.
    await expectCode(lists.saveDraftVersion(rep, l!.id, v1.id, { effectiveFrom: today, entries: [{ productId: style, uomId: pcs, minQuantity: 0, unitPrice: 1 }, { productId: style, uomId: pcs, minQuantity: 0, unitPrice: 2 }], version: v1.version }), "VALIDATION_ERROR");
    await expectCode(lists.saveDraftVersion(rep, l!.id, v1.id, { effectiveFrom: today, effectiveTo: plusDays(-1), entries: [], version: v1.version }), "VALIDATION_ERROR");
    await lists.priceVersionAction(rep, l!.id, v1.id, "submit", { comment: "first prices" });
    await expectCode(lists.priceVersionAction(rep, l!.id, v1.id, "approve", {}), "PERMISSION_DENIED"); // rep isn't an approver
    approvers.add(rep.userId);
    await expectCode(lists.priceVersionAction(rep, l!.id, v1.id, "approve", {}), "SELF_APPROVAL_NOT_ALLOWED");
    approvers.delete(rep.userId);
    const approved = await lists.priceVersionAction(manager, l!.id, v1.id, "approve", { comment: "ok" });
    expect(approved).toMatchObject({ selected: { status: "APPROVED", timing: "IN_FORCE" } });
    await expectCode(lists.saveDraftVersion(rep, l!.id, v1.id, { effectiveFrom: today, entries: [], version: 99 }), "INVALID_STATE_TRANSITION");
    await expectCode(lists.priceVersionAction(manager, l!.id, v1.id, "approve", {}), "INVALID_STATE_TRANSITION");

    // v2 from next week at ₹110: scheduled; today still ₹100.
    const v2view = await lists.startNewVersion(rep, l!.id);
    expect(v2view.selected).toMatchObject({ versionNumber: 2, status: "DRAFT", entries: expect.arrayContaining([expect.objectContaining({ minQuantity: expect.anything() })]) });
    await expectCode(lists.startNewVersion(rep, l!.id), "INVALID_STATE_TRANSITION"); // one open version
    const v2 = v2view.selected!;
    await lists.saveDraftVersion(rep, l!.id, v2.id, { effectiveFrom: plusDays(7), entries: [{ productId: style, uomId: pcs, minQuantity: 0, unitPrice: 110 }], version: v2.version });
    await lists.priceVersionAction(rep, l!.id, v2.id, "submit", {});
    await lists.priceVersionAction(manager, l!.id, v2.id, "decline", { reason: "too high" });
    expect((await prisma.priceListVersion.findUniqueOrThrow({ where: { id: v2.id } })).status).toBe("DRAFT");
    await lists.priceVersionAction(rep, l!.id, v2.id, "submit", {});
    const after = (await lists.priceVersionAction(manager, l!.id, v2.id, "approve", {})) as Awaited<ReturnType<typeof lists.getPriceList>>;
    expect(after.versions.map((v) => [v.versionNumber, v.status, v.timing])).toEqual([
      [2, "APPROVED", "SCHEDULED"],
      [1, "APPROVED", "IN_FORCE"],
    ]);
    const [now, later] = await Promise.all([
      pricing.priceLines(rep, { date: today, customerId: null }, [{ productId: style, quantity: 10, uomId: pcs }]),
      pricing.priceLines(rep, { date: plusDays(8), customerId: null }, [{ productId: style, quantity: 10, uomId: pcs }]),
    ]);
    expect([now[0].netUnitPrice, later[0].netUnitPrice]).toEqual([100, 110]);
    // A scheduled version can be withdrawn; prices next week fall back to v1.
    await lists.priceVersionAction(rep, l!.id, v2.id, "withdraw", { reason: "postponed" });
    expect((await pricing.priceLines(rep, { date: plusDays(8) }, [{ productId: style, quantity: 10, uomId: pcs }]))[0].netUnitPrice).toBe(100);
    const events = await prisma.pricingEvent.findMany({ where: { entityId: l!.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.type)).toEqual(["CREATED", "SUBMITTED", "APPROVED", "VERSION_CREATED", "UPDATED", "SUBMITTED", "DECLINED", "SUBMITTED", "APPROVED", "WITHDRAWN"]);
    expect(await prisma.auditLog.count({ where: { tableName: "price_lists", recordId: l!.id } })).toBeGreaterThanOrEqual(10);
    // Leave this list out of the later tests.
    await lists.priceListAction(rep, l!.id, "deactivate");
  });

  it("two active lists of the same kind can't share a priority; past start dates can't be approved", async () => {
    const a = await approvedList({ priority: 7, entries: [{ productId: style2, uomId: pcs, unitPrice: 1 }] });
    await expectCode(lists.createPriceList(rep, { code: code("CLASH"), name: "x", kind: "DEFAULT", priority: 7, effectiveFrom: today, entries: [] }), "VALIDATION_ERROR");
    await lists.priceListAction(rep, a, "deactivate");
    const b = await approvedList({ priority: 7, entries: [{ productId: style2, uomId: pcs, unitPrice: 2 }] });
    await expectCode(lists.priceListAction(rep, a, "reactivate"), "VALIDATION_ERROR");
    await lists.priceListAction(rep, b, "deactivate");
    const past = await lists.createPriceList(rep, { code: code("PAST"), name: "x", kind: "DEFAULT", priority: 70, effectiveFrom: plusDays(-1), entries: [{ productId: style2, uomId: pcs, unitPrice: 1 }] });
    const pv = await prisma.priceListVersion.findFirstOrThrow({ where: { priceListId: past!.id } });
    await expectCode(lists.priceVersionAction(rep, past!.id, pv.id, "submit", {}), "VALIDATION_ERROR");
    // Discarding the only draft removes the list.
    expect(await lists.priceVersionAction(rep, past!.id, pv.id, "discard", {})).toEqual({ id: past!.id, deleted: true });
    expect(await prisma.priceList.count({ where: { id: past!.id } })).toBe(0);
  });

  it("customer list beats default, prospects get the default, breaks and units, tenant isolation", async () => {
    const def = await approvedList({ priority: 2, entries: [{ productId: style, uomId: pcs, minQuantity: 0, unitPrice: 100 }, { productId: style, uomId: pcs, minQuantity: 120, unitPrice: 95 }] });
    const cust = await approvedList({ kind: "CUSTOMER", customerId: customer, priority: 0, entries: [{ productId: style, uomId: pcs, minQuantity: 0, unitPrice: 92 }] });
    const ctx = (customerId: string | null, quantity: number, uomId = pcs) => pricing.priceLines(rep, { date: today, customerId }, [{ productId: style, quantity, uomId }]).then((r) => r[0]);
    expect(await ctx(customer, 10)).toMatchObject({ netUnitPrice: 92, source: { priceListId: cust, level: "CUSTOMER" } });
    expect(await ctx(otherCustomer, 10)).toMatchObject({ netUnitPrice: 100, source: { priceListId: def } });
    expect(await ctx(null, 119)).toMatchObject({ netUnitPrice: 100 });
    expect(await ctx(null, 120)).toMatchObject({ netUnitPrice: 95 });
    expect(await ctx(null, 10, dzn)).toMatchObject({ netUnitPrice: 1140, source: { entryUomCode: "PCS", conversionFactor: 12 } }); // 120 pcs break
    // Another company sees none of it.
    await expectCode(pricing.priceLines(outsider, { customerId: customer }, [{ productId: style, quantity: 1, uomId: pcs }]), "NOT_FOUND");
    expect((await pricing.priceLines(outsider, {}, [{ productId: style, quantity: 1, uomId: pcs }]))[0]).toMatchObject({ status: "INVALID" });
    await expectCode(lists.getPriceList(outsider, def), "NOT_FOUND");
  });

  it("discount rules: approval, conditions, best exclusive vs stacked, cap, deactivate", async () => {
    // Uses the default (₹100 / ₹95 at 120+) and customer (₹92) lists from the previous test.
    const r10 = await activeRule({ value: 10, categoryId: category });
    const price = (customerId: string | null, quantity = 10) => pricing.priceLines(rep, { date: today, customerId }, [{ productId: style, quantity, uomId: pcs }]).then((r) => r[0]);
    expect(await price(null)).toMatchObject({ listUnitPrice: 100, netUnitPrice: 90, rules: [expect.objectContaining({ id: r10 })] });
    const s5 = await activeRule({ value: 5, stacking: "STACKABLE", priority: 2 });
    const s5amt = await activeRule({ discountType: "AMOUNT_PER_UNIT", value: 3, stacking: "STACKABLE", priority: 1, customerId: customer });
    // Prospect: exclusive 10 vs stack 5 → exclusive. Customer: 92 → 5% = 87.4 → −3 = 84.4 (7.6) vs 10% (9.2) → exclusive 82.8.
    expect((await price(null)).netUnitPrice).toBe(90);
    expect((await price(customer)).netUnitPrice).toBe(82.8);
    await rules.discountRuleAction(rep, r10, "deactivate", { reason: "promo over" });
    expect(await price(customer)).toMatchObject({ netUnitPrice: 84.4, rules: [expect.objectContaining({ id: s5 }), expect.objectContaining({ id: s5amt })] });
    await settings.updateSalesMarketingSettings(manager, { quotationApprovalMaxDiscountPercent: 10, quotationApprovalMaxTotal: 500000, quotationDefaultValidityDays: 30, pricingMaxRuleDiscountPercent: 5 });
    expect(await price(customer)).toMatchObject({ netUnitPrice: 87.4, ruleDiscountCapped: true });
    await settings.updateSalesMarketingSettings(manager, { quotationApprovalMaxDiscountPercent: 10, quotationApprovalMaxTotal: 500000, quotationDefaultValidityDays: 30, pricingMaxRuleDiscountPercent: null });
    // Self-approval and editing an active rule are refused.
    const mine = await rules.createDiscountRule(manager, { code: code("MINE"), name: "x", discountType: "PERCENT", value: 1, stacking: "EXCLUSIVE", validFrom: today });
    await rules.discountRuleAction(manager, mine.id, "submit", {});
    await expectCode(rules.discountRuleAction(manager, mine.id, "approve", {}), "SELF_APPROVAL_NOT_ALLOWED");
    const active = await rules.getDiscountRule(rep, s5);
    await expectCode(rules.updateDiscountRule(rep, s5, { name: "x", discountType: "PERCENT", value: 1, stacking: "EXCLUSIVE", validFrom: today, version: active.version }), "INVALID_STATE_TRANSITION");
    await expectCode(rules.createDiscountRule(rep, { code: code("BAD"), name: "x", discountType: "PERCENT", value: 120, stacking: "EXCLUSIVE", validFrom: today }), "VALIDATION_ERROR");
    for (const id of [s5, s5amt]) await rules.discountRuleAction(rep, id, "deactivate", { reason: "cleanup" });
  });

  it("quotations: auto price + snapshot, override needs reason + permission, below-list override needs approval", async () => {
    const q = await quotes.createQuotation(rep, quoteBody([line(), line({ productId: style, quantity: 10, uomId: dzn }), { description: "Free item", quantity: 2, unitPrice: 50, taxRateId: gst5 }]));
    const d = await quotes.getQuotation(rep, q.id);
    expect(d.current.lines.map((l) => [l.priceSource, Number(l.unitPrice), l.listUnitPrice === null ? null : Number(l.listUnitPrice)])).toEqual([
      ["PRICE_LIST", 92, 92],
      ["PRICE_LIST", 1104, 1104],
      ["MANUAL", 50, null],
    ]);
    expect(d.current.lines[0].pricing).toMatchObject({ status: "PRICED", source: { level: "CUSTOMER" }, explanation: expect.arrayContaining([expect.stringContaining("Customer price list")]) });
    expect(d.approvalPreview).toEqual([]);

    const body = (l: Record<string, unknown>) => quoteBody([line(l)]);
    // Override without a reason / without the permission.
    await expectCode(quotes.createQuotation(rep, body({ priceMode: "MANUAL", unitPrice: 80 })), "VALIDATION_ERROR");
    await expectCode(quotes.createQuotation(rep2, body({ priceMode: "MANUAL", unitPrice: 80, priceOverrideReason: "match competitor" })), "PERMISSION_DENIED");
    // Same price typed by hand = list price; AUTO without any list = refused.
    const same = await quotes.createQuotation(rep, body({ priceMode: "MANUAL", unitPrice: 92 }));
    expect((await quotes.getQuotation(rep, same.id)).current.lines[0].priceSource).toBe("PRICE_LIST");
    await expectCode(quotes.createQuotation(rep, quoteBody([line({ productId: style2 })])), "VALIDATION_ERROR");

    const over = await quotes.createQuotation(rep, body({ priceMode: "MANUAL", unitPrice: 80, priceOverrideReason: "match competitor" }));
    const od = await quotes.getQuotation(rep, over.id);
    expect(od.current.lines[0]).toMatchObject({ priceSource: "OVERRIDE", priceOverrideReason: "match competitor" });
    expect(Number(od.current.lines[0].calculatedUnitPrice)).toBe(92);
    expect(od.approvalPreview).toEqual(["Line 1: price ₹80.00 is below the price-list price ₹92.00"]);
    await expectCode(life.issueQuotation(rep, over.id, {}), "INVALID_STATE_TRANSITION"); // needs approval first
    const above = await quotes.createQuotation(rep, body({ priceMode: "MANUAL", unitPrice: 99, priceOverrideReason: "rush order" }));
    expect((await quotes.getQuotation(rep, above.id)).approvalPreview).toEqual([]);
  });

  it("issue re-checks prices; issued quotations keep their prices when the list changes", async () => {
    const def = await approvedList({ priority: 40, kind: "CUSTOMER", customerId: otherCustomer, entries: [{ productId: style2, uomId: pcs, unitPrice: 200 }] });
    const q = await quotes.createQuotation(rep, quoteBody([line({ productId: style2, quantity: 5 })], { customerId: otherCustomer }));
    const issued = await quotes.createQuotation(rep, quoteBody([line({ productId: style2, quantity: 5 })], { customerId: otherCustomer }));
    await life.issueQuotation(rep, issued.id, {});
    // Price change through a rule (lists can't change today's price without a new version).
    const rule = await activeRule({ value: 10, productId: style2 });
    await expectCode(life.issueQuotation(rep, q.id, {}), "VALIDATION_ERROR"); // ₹200 → ₹180 not yet seen
    const d = await quotes.getQuotation(rep, q.id);
    await quotes.updateQuotationDraft(rep, q.id, { ...quoteBody([line({ productId: style2, quantity: 5 })], { customerId: otherCustomer }), version: d.current.version });
    expect(Number((await quotes.getQuotation(rep, q.id)).current.lines[0].unitPrice)).toBe(180);
    await expect(life.issueQuotation(rep, q.id, {})).resolves.toMatchObject({ status: "ISSUED" });
    // The quotation issued earlier is untouched.
    const kept = await quotes.getQuotation(rep, issued.id);
    expect([Number(kept.current.lines[0].unitPrice), kept.current.status]).toEqual([200, "ISSUED"]);
    await rules.discountRuleAction(rep, rule, "deactivate", { reason: "done" });
    await lists.priceListAction(rep, def, "deactivate");
  });

  it("only one of two concurrent approvals goes through", async () => {
    const l = await lists.createPriceList(rep, { code: code("RACE"), name: "x", kind: "DEFAULT", priority: 90, effectiveFrom: today, entries: [{ productId: style2, uomId: pcs, unitPrice: 1 }] });
    const v = await prisma.priceListVersion.findFirstOrThrow({ where: { priceListId: l!.id } });
    await lists.priceVersionAction(rep, l!.id, v.id, "submit", {});
    const second = (await prisma.user.create({ data: { companyId: rep.companyId, email: `m2.${run}@pr-it.local`, passwordHash: "x", fullName: `m2 ${run}` } })).id;
    approvers.add(second);
    const results = await Promise.allSettled([lists.priceVersionAction(manager, l!.id, v.id, "approve", {}), lists.priceVersionAction({ ...manager, userId: second }, l!.id, v.id, "approve", {})]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.pricingEvent.count({ where: { entityId: l!.id, type: "APPROVED" } })).toBe(1);
    await lists.priceListAction(rep, l!.id, "deactivate");
  });
});
