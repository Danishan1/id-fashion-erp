/**
 * Promotions & campaign budgets (Sales & Marketing Phase 12) against a real,
 * migrated + seeded Postgres database. Skipped unless CRM_IT_DATABASE_URL
 * points at a DISPOSABLE database.
 *
 * Permissions are mocked: "manager" approves (never their own work), "rep"
 * does everything else, "outsider" belongs to another company.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { alignEnquiryCounter } from "../integration-test-helpers";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const approvers = new Set<string>();
const can = async (userId: string, _module: string, action: string, ctx?: { createdBy?: string }) => {
  if (action === "approve" || action === "reject") return approvers.has(userId) && ctx?.createdBy !== userId;
  return true;
};
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(can),
    assert: vi.fn(async (userId: string, module: string, action: string, ctx?: { createdBy?: string }) => {
      if (!(await can(userId, module, action, ctx))) throw Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" });
    }),
    assertAny: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("Promotions & campaign budgets (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const promos = await import("./promotion.service");
  const redemption = await import("./redemption.service");
  const pricing = await import("@/modules/sales-marketing/pricing/pricing.service");
  const lists = await import("@/modules/sales-marketing/pricing/price-list.service");
  const quotes = await import("@/modules/sales-marketing/quotations/quotation.service");
  const life = await import("@/modules/sales-marketing/quotations/quotation-lifecycle.service");
  const budgets = await import("@/modules/sales-marketing/budgets/budget.service");
  const lookups = await import("@/modules/sales-marketing/campaigns/campaign-lookup.service");

  const run = `q${Date.now().toString(36)}`;
  let rep: Actor, manager: Actor, outsider: Actor;
  let customer: string, customer2: string, style: string, pcs: string, gst5: string, supplier: string;
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
  const code = (p: string) => `${p}${run}${seq++}`.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 30);

  const terms = (extra: Record<string, unknown> = {}) => ({ validFrom: today, discountType: "PERCENT", value: 10, stacking: "EXCLUSIVE", productIds: [style], ...extra });
  /** Created by rep, submitted, approved by manager, switched on. */
  const livePromotion = async (applyMode: "AUTO" | "CODE", extra: Record<string, unknown> = {}) => {
    const c = code("P");
    const { id } = await promos.createPromotion(rep, { code: c, name: `Promo ${c}`, applyMode, terms: terms(extra) });
    const v = await prisma.marketingPromotionVersion.findFirstOrThrow({ where: { promotionId: id } });
    await promos.submitVersion(rep, id, v.id, {});
    await promos.approveVersion(manager, id, v.id, {});
    await promos.promotionAction(manager, id, "activate", {});
    return { id, code: c, versionId: v.id };
  };
  const quote = (customerId: string, extra: Record<string, unknown> = {}) =>
    quotes.createQuotation(rep, {
      customerId,
      title: `${run} promo`,
      quotationDate: today,
      validUntil: plusDays(20),
      lines: [{ productId: style, description: "Polo", quantity: 10, uomId: pcs, unitPrice: 0, taxRateId: gst5, priceMode: "AUTO" }],
      ...extra,
    }) as Promise<{ id: string }>;
  const redemptions = (promotionId: string) => prisma.marketingPromotionRedemption.findMany({ where: { promotionId }, orderBy: { reservedAt: "asc" } });

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    await alignEnquiryCounter(prisma, company.id);
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@promo-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [r, m] = await Promise.all([mk("rep"), mk("manager")]);
    const actor = (id: string) => ({ companyId: company.id, userId: id, branchId: null });
    [rep, manager] = [actor(r.id), actor(m.id)];
    approvers.add(m.id);
    const other = await prisma.company.create({ data: { name: `Other ${run}`, baseCurrencyCode: "INR" } });
    outsider = { companyId: other.id, userId: r.id, branchId: null };
    customer = (await prisma.customer.create({ data: { companyId: company.id, code: `QC-${run}`, name: `Promo Customer ${run}` } })).id;
    customer2 = (await prisma.customer.create({ data: { companyId: company.id, code: `QD-${run}`, name: `Promo Customer 2 ${run}` } })).id;
    pcs = (await prisma.unitOfMeasure.findFirstOrThrow({ where: { code: "PCS" } })).id;
    style = (await prisma.product.create({ data: { companyId: company.id, styleCode: `QP-${run}`, styleName: `Promo Polo ${run}`, itemType: "STYLE", baseUomId: pcs } })).id;
    const taxType = await prisma.taxType.create({ data: { companyId: company.id, code: `GSTQ-${run}`, name: "GST" } });
    gst5 = (await prisma.taxRate.create({ data: { companyId: company.id, taxTypeId: taxType.id, name: `GST 5% ${run}`, ratePercentage: "5", effectiveFrom: new Date("2020-01-01") } })).id;
    const cat = await prisma.supplierCategory.create({ data: { companyId: company.id, code: `SC-${run}`, name: `Agencies ${run}` } });
    supplier = (await prisma.supplier.create({ data: { companyId: company.id, code: `QS-${run}`, name: `Media House ${run}`, categoryId: cat.id } })).id;
    // Others' promotions, lists and rules must not interfere.
    await prisma.marketingPromotion.updateMany({ where: { companyId: company.id, status: { in: ["ACTIVE", "PAUSED"] } }, data: { status: "ARCHIVED" } });
    await prisma.discountRule.updateMany({ where: { companyId: company.id, status: "ACTIVE" }, data: { status: "INACTIVE" } });
    await prisma.priceList.updateMany({ where: { companyId: company.id }, data: { isActive: false } });
    const l = await lists.createPriceList(rep, { code: `QL-${run}`, name: "Promo list", kind: "DEFAULT", priority: 0, effectiveFrom: today, entries: [{ productId: style, uomId: pcs, minQuantity: 0, unitPrice: 200 }] });
    const lv = await prisma.priceListVersion.findFirstOrThrow({ where: { priceListId: l!.id } });
    await lists.priceVersionAction(rep, l!.id, lv.id, "submit", {});
    await lists.priceVersionAction(manager, l!.id, lv.id, "approve", {});
  });

  afterAll(async () => {
    await prisma.marketingPromotion.updateMany({ where: { companyId: rep.companyId, code: { contains: run.toUpperCase() }, status: { not: "ARCHIVED" } }, data: { status: "ARCHIVED" } });
    await prisma.$disconnect();
  });

  it("lifecycle: draft → submit → approve by someone else; approved terms are frozen; new version supersedes; switch on is separate", async () => {
    const c = code("LIFE");
    await expectCode(promos.createPromotion(rep, { code: c, name: "x", applyMode: "AUTO", terms: terms({ value: 120 }) }), "VALIDATION_ERROR");
    await expectCode(promos.createPromotion(rep, { code: c, name: "x", applyMode: "AUTO", terms: terms({ productIds: ["00000000-0000-0000-0000-000000000000"] }) }), "VALIDATION_ERROR");
    const { id } = await promos.createPromotion(rep, { code: c, name: "Life", applyMode: "AUTO", terms: terms() });
    await expectCode(promos.createPromotion(rep, { code: c, name: "dup", applyMode: "AUTO", terms: terms() }), "VALIDATION_ERROR");
    const v1 = await prisma.marketingPromotionVersion.findFirstOrThrow({ where: { promotionId: id } });
    await expectCode(promos.promotionAction(manager, id, "activate", {}), "INVALID_STATE_TRANSITION"); // nothing approved
    await promos.saveVersionTerms(rep, id, v1.id, terms({ value: 12 }));
    await promos.submitVersion(rep, id, v1.id, {});
    await expectCode(promos.saveVersionTerms(rep, id, v1.id, terms()), "INVALID_STATE_TRANSITION");
    await expectCode(promos.approveVersion(rep, id, v1.id, {}), "PERMISSION_DENIED");
    await promos.approveVersion(manager, id, v1.id, {});
    let p = await prisma.marketingPromotion.findUniqueOrThrow({ where: { id } });
    expect([p.status, p.approvedVersionId]).toEqual(["DRAFT", v1.id]); // approved, not yet on
    // The database refuses any change to an approved version.
    await expect(prisma.marketingPromotionVersion.update({ where: { id: v1.id }, data: { value: "50" } })).rejects.toThrow(/can't be changed/);
    await promos.newVersion(rep, id);
    await expectCode(promos.newVersion(rep, id), "INVALID_STATE_TRANSITION"); // one open version at a time
    const v2 = await prisma.marketingPromotionVersion.findFirstOrThrow({ where: { promotionId: id, versionNumber: 2 } });
    expect(Number(v2.value)).toBe(12);
    await promos.saveVersionTerms(rep, id, v2.id, terms({ value: 15, changeNote: "Bigger" }));
    await promos.submitVersion(rep, id, v2.id, {});
    await expectCode(promos.rejectVersion(manager, id, v2.id, {}), "VALIDATION_ERROR"); // needs a reason
    await promos.approveVersion(manager, id, v2.id, { comment: "ok" });
    const [a, b] = await prisma.marketingPromotionVersion.findMany({ where: { promotionId: id }, orderBy: { versionNumber: "asc" } });
    expect([a.status, b.status]).toEqual(["SUPERSEDED", "APPROVED"]);
    await promos.promotionAction(manager, id, "activate", {});
    await promos.promotionAction(rep, id, "pause", {});
    p = await prisma.marketingPromotion.findUniqueOrThrow({ where: { id } });
    expect(p.status).toBe("PAUSED");
    await promos.promotionAction(rep, id, "archive", {});
    await expectCode(promos.newVersion(rep, id), "INVALID_STATE_TRANSITION");
    const events = await prisma.pricingEvent.findMany({ where: { entityType: "PROMOTION", entityId: id } });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["CREATED", "SUBMITTED", "APPROVED", "VERSION_CREATED", "ACTIVATE", "PAUSE", "ARCHIVE"]));
  });

  it("pricing: an automatic promotion applies; a code promotion only with its code; unknown codes are reported; preview never reserves", async () => {
    const auto = await livePromotion("AUTO", { value: 10, stacking: "STACKABLE" });
    const coded = await livePromotion("CODE", { value: 5, stacking: "STACKABLE" });
    const plain = await pricing.calculatePrices(rep, { date: today, customerId: customer, lines: [{ productId: style, quantity: 10, uomId: pcs }] });
    expect(plain.results[0].netUnitPrice).toBe(180);
    const withCode = await pricing.calculatePrices(rep, { date: today, customerId: customer, promotionCodes: [coded.code, "NOPE123"], lines: [{ productId: style, quantity: 10, uomId: pcs }] });
    expect(withCode.results[0].netUnitPrice).toBe(171); // 200 → 180 → 171
    expect(withCode.promotions.invalidCodes).toEqual([{ code: "NOPE123", reason: "No promotion has this code." }]);
    expect(await redemptions(auto.id)).toEqual([]);
    await promos.promotionAction(rep, auto.id, "archive", {});
    await promos.promotionAction(rep, coded.id, "archive", {});
  });

  it("issue reserves, revise and reject release, accept keeps it, the limit holds; a quotation can't save with a bad code", async () => {
    const p = await livePromotion("AUTO", { value: 10, maxRedemptions: 2, maxRedemptionsPerCustomer: 1 });
    await expectCode(quote(customer, { promotionCodes: ["NOSUCHCODE"] }), "VALIDATION_ERROR");
    const q1 = await quote(customer);
    const r1 = await prisma.quotationRevision.findFirstOrThrow({ where: { quotationId: q1.id }, include: { lines: true } });
    expect(Number(r1.lines[0].unitPrice)).toBe(180);
    expect(await redemptions(p.id)).toEqual([]); // saving a draft reserves nothing
    await life.issueQuotation(rep, q1.id, {});
    let rows = await redemptions(p.id);
    expect(rows.map((r) => [r.status, Number(r.discountAmount)])).toEqual([["RESERVED", 200]]);
    expect(rows[0].expiresOn.toISOString().slice(0, 10)).toBe(plusDays(20));
    // Issuing twice (retry) doesn't count twice.
    await prisma.$transaction((tx) => redemption.reserveForRevision(tx, rep, { id: q1.id, quotationNumber: "x", customerId: customer }, { id: r1.id, validUntil: r1.validUntil }, r1.lines));
    expect((await redemptions(p.id)).length).toBe(1);
    // Per-customer limit: the same customer no longer gets it.
    const again = await pricing.calculatePrices(rep, { date: today, customerId: customer, lines: [{ productId: style, quantity: 10, uomId: pcs }] });
    expect(again.results[0].netUnitPrice).toBe(200);
    // Revise releases the issued revision's reservation.
    await life.reviseQuotation(rep, q1.id, { reason: "New qty" });
    rows = await redemptions(p.id);
    expect(rows[0].status).toBe("RELEASED");
    expect(rows[0].releaseReason).toMatch(/Revised/);
    // Customer 2: issue, accept (no longer expires).
    const q2 = await quote(customer2);
    await life.issueQuotation(rep, q2.id, {});
    await life.recordAcceptance(rep, q2.id, { decisionDate: today, method: "EMAIL" });
    const held = (await redemptions(p.id)).find((r) => r.quotationId === q2.id)!;
    expect([held.status, held.expiresOn.toISOString().slice(0, 10)]).toEqual(["RESERVED", "9999-12-31"]);
    // A reservation can't go backwards (database trigger).
    await prisma.marketingPromotionRedemption.update({ where: { id: rows[0].id }, data: { status: "RESERVED" } }).then(
      () => expect.unreachable("a released use must not come back"),
      (e: Error) => expect(e.message).toMatch(/can't go back/)
    );
    await promos.promotionAction(rep, p.id, "archive", {});
  });

  it("concurrent issues can't go over the total limit (row lock on the promotion)", async () => {
    const p = await livePromotion("AUTO", { value: 10, maxRedemptions: 1 });
    // Both drafts are priced while the promotion is still free.
    const [qa, qb] = [await quote(customer), await quote(customer2)];
    const results = await Promise.allSettled([life.issueQuotation(rep, qa.id, {}), life.issueQuotation(rep, qb.id, {})]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(failed.reason?.message)).toMatch(/limit|changed/i);
    expect((await redemptions(p.id)).filter((r) => r.status === "RESERVED").length).toBe(1);
    // The quotation that lost stays a draft and can be re-saved (now priced without the promotion).
    const lost = results[0].status === "rejected" ? qa : qb;
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: lost.id } })).status).toBe("DRAFT");
    await promos.promotionAction(rep, p.id, "archive", {});
  });

  it("cancel releases; an expired reservation stops counting and is tidied by the worker", async () => {
    const p = await livePromotion("AUTO", { value: 10, maxRedemptions: 1 });
    const q = await quote(customer);
    await life.issueQuotation(rep, q.id, {});
    await life.cancelQuotation(rep, q.id, { reason: "Customer went away" });
    expect((await redemptions(p.id))[0].status).toBe("RELEASED");
    const q2 = await quote(customer2);
    await life.issueQuotation(rep, q2.id, {});
    const r = (await redemptions(p.id)).find((x) => x.status === "RESERVED")!;
    await prisma.$executeRaw`UPDATE marketing_promotion_redemptions SET expires_on = ${new Date(`${plusDays(-1)}T00:00:00Z`)} WHERE id = ${r.id}::uuid`;
    const { usageCount } = await import("./promotion-eligibility");
    expect(await usageCount(prisma, p.id)).toBe(0);
    expect(await redemption.releaseExpiredReservations()).toBeGreaterThanOrEqual(1);
    expect((await prisma.marketingPromotionRedemption.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("RELEASED");
    await promos.promotionAction(rep, p.id, "archive", {});
  });

  it("other companies can't see or change a promotion", async () => {
    const p = await livePromotion("CODE");
    await expectCode(promos.getPromotion(outsider, p.id), "NOT_FOUND");
    await expectCode(promos.promotionAction(outsider, p.id, "pause", {}), "NOT_FOUND");
    const { promotionsForPricing } = await import("./promotion-eligibility");
    const other = await promotionsForPricing({ companyId: outsider.companyId, date: today, customerId: null, salesChannelId: null, campaignId: null, codes: [p.code] });
    expect(other.invalidCodes[0]?.code).toBe(p.code);
    expect(other.rules).toEqual([]);
    await promos.promotionAction(rep, p.id, "archive", {});
  });

  // ── Budgets ────────────────────────────────────────────────────

  describe("campaign budgets", () => {
    let campaignId = "";
    let otherCampaign = "";
    let spendCategory = "";
    const mkCampaign = async (c: string, budget: number | null, approved = true) => {
      await lookups.ensureCampaignLookups(rep.companyId);
      const all = await prisma.marketingCampaignLookup.findMany({ where: { companyId: rep.companyId } });
      spendCategory = all.find((l) => l.kind === "SPEND_CATEGORY")!.id;
      return (
        await prisma.marketingCampaign.create({
          data: {
            companyId: rep.companyId,
            code: c,
            name: c,
            typeId: all.find((l) => l.kind === "TYPE")!.id,
            objectiveId: all.find((l) => l.kind === "OBJECTIVE")!.id,
            ownerUserId: rep.userId,
            status: "ACTIVE",
            plannedStartDate: new Date(`${plusDays(-5)}T00:00:00Z`),
            plannedEndDate: new Date(`${plusDays(30)}T00:00:00Z`),
            actualStartDate: new Date(`${plusDays(-5)}T00:00:00Z`),
            plannedBudget: budget,
            approvedRevisionNumber: approved ? 1 : null,
            currencyCode: "INR",
            createdByUserId: rep.userId,
            updatedByUserId: rep.userId,
          },
        })
      ).id;
    };
    const exp = (n: string, amount: number, status: "APPROVED" | "PENDING_APPROVAL" | "REJECTED" = "APPROVED") =>
      prisma.expense.create({ data: { companyId: rep.companyId, expenseNumber: `QX-${run}-${n}`, expenseDate: new Date(`${today}T00:00:00Z`), description: `Ad ${n}`, amount, taxAmount: amount * 0.18, totalAmount: amount * 1.18, currencyCode: "INR", status, createdByUserId: rep.userId } });
    const po = (n: string, amount: number, status = "APPROVED") =>
      prisma.purchaseOrder.create({ data: { companyId: rep.companyId, orderNumber: `QPO-${run}-${n}`, supplierId: supplier, orderDate: new Date(`${today}T00:00:00Z`), currencyCode: "INR", baseCurrencyCode: "INR", requestedByUserId: rep.userId, totalAmount: amount, baseTotalAmount: amount, status: status as "APPROVED" } });
    const pi = (n: string, subtotal: number, purchaseOrderId: string | null, status = "POSTED") =>
      prisma.purchaseInvoice.create({ data: { companyId: rep.companyId, invoiceNumber: `QPI-${run}-${n}`, supplierId: supplier, invoiceDate: new Date(`${today}T00:00:00Z`), dueDate: new Date(`${plusDays(30)}T00:00:00Z`), currencyCode: "INR", baseCurrencyCode: "INR", createdByUserId: rep.userId, subtotalAmount: subtotal, taxAmount: subtotal * 0.18, totalAmount: subtotal * 1.18, baseTotalAmount: subtotal * 1.18, purchaseOrderId, status: status as "POSTED" } });
    const budget = () => budgets.getCampaignBudget(rep, campaignId);

    beforeAll(async () => {
      campaignId = await mkCampaign(`QB-${run}`, 100000);
      otherCampaign = await mkCampaign(`QO-${run}`, 50000);
    });

    it("budget lines can't add up to more than the approved budget; a campaign without one can't have lines", async () => {
      await budgets.createAllocation(rep, campaignId, { name: "Media", categoryId: spendCategory, amount: 60000 });
      await budgets.createAllocation(rep, campaignId, { name: "Print", categoryId: spendCategory, amount: 30000 });
      await expectCode(budgets.createAllocation(rep, campaignId, { name: "Events", categoryId: spendCategory, amount: 10001 }), "VALIDATION_ERROR");
      await expectCode(budgets.createAllocation(rep, campaignId, { name: "media", categoryId: spendCategory, amount: 1 }), "VALIDATION_ERROR"); // duplicate name
      const unapproved = await mkCampaign(`QU-${run}`, 20000, false);
      await expectCode(budgets.createAllocation(rep, unapproved, { name: "X", categoryId: spendCategory, amount: 1 }), "INVALID_STATE_TRANSITION");
      const b = await budget();
      expect([b.approved, b.totals.allocated, b.totals.unallocatedLimit]).toEqual([100000, 90000, 10000]);
    });

    it("linked expenses, purchase orders and invoices: actual, committed and pipeline without double counting", async () => {
      const b0 = await budget();
      const media = b0.allocations.find((a) => a.name === "Media")!;
      const print = b0.allocations.find((a) => a.name === "Print")!;
      const [e1, e2, e3] = [await exp("1", 20000), await exp("2", 5000, "PENDING_APPROVAL"), await exp("3", 999, "REJECTED")];
      await budgets.linkSpend(rep, campaignId, { kind: "EXPENSE", recordId: e1.id, allocationId: media.id });
      await budgets.linkSpend(rep, campaignId, { kind: "EXPENSE", recordId: e2.id });
      await expectCode(budgets.linkSpend(rep, campaignId, { kind: "EXPENSE", recordId: e3.id }), "VALIDATION_ERROR");
      const order = await po("1", 30000);
      await budgets.linkSpend(rep, campaignId, { kind: "PURCHASE_ORDER", recordId: order.id, allocationId: print.id });
      let b = await budget();
      expect([b.totals.actual, b.totals.committed, b.totals.pipeline, b.totals.remaining]).toEqual([20000, 30000, 5000, 50000]);
      // An invoice against the order counts through it: committed → actual, total unchanged.
      const inv = await pi("1", 12000, order.id);
      await expectCode(budgets.linkSpend(rep, campaignId, { kind: "PURCHASE_INVOICE", recordId: inv.id }), "VALIDATION_ERROR");
      b = await budget();
      expect([b.totals.actual, b.totals.committed]).toEqual([32000, 18000]);
      expect(b.allocations.find((a) => a.id === print.id)).toMatchObject({ actual: 12000, committed: 18000 });
      expect(b.purchaseInvoices?.find((i) => i.id === inv.id)?.inherited).toBe(true);
      // A standalone invoice links directly; an invoice on another campaign's order can't count here.
      const lone = await pi("2", 3000, null);
      await budgets.linkSpend(rep, campaignId, { kind: "PURCHASE_INVOICE", recordId: lone.id, allocationId: media.id });
      const otherOrder = await po("2", 1000);
      await budgets.linkSpend(rep, otherCampaign, { kind: "PURCHASE_ORDER", recordId: otherOrder.id });
      const otherInv = await pi("3", 1000, otherOrder.id);
      await prisma.purchaseInvoice.update({ where: { id: otherInv.id }, data: { campaignId: null } });
      await expectCode(budgets.linkSpend(rep, campaignId, { kind: "PURCHASE_INVOICE", recordId: otherInv.id }), "VALIDATION_ERROR");
      await expectCode(budgets.linkSpend(rep, campaignId, { kind: "PURCHASE_ORDER", recordId: otherOrder.id }), "VALIDATION_ERROR"); // on another campaign
      b = await budget();
      expect(b.totals.actual).toBe(35000);
      // Moving a record between lines changes the lines, not the total.
      await budgets.linkSpend(rep, campaignId, { kind: "EXPENSE", recordId: e1.id, allocationId: print.id });
      b = await budget();
      expect(b.totals.actual).toBe(35000);
      expect(b.allocations.find((a) => a.id === print.id)!.actual).toBe(32000);
    });

    it("lines: can't shrink below what's used; move budget between lines; a used line can't be removed", async () => {
      let b = await budget();
      const media = b.allocations.find((a) => a.name === "Media")!;
      const print = b.allocations.find((a) => a.name === "Print")!;
      // Print: 32000 actual + 18000 committed = 50000 used of 30000 → over; moving budget to it is the fix.
      await expectCode(budgets.transferAllocation(rep, campaignId, { fromId: media.id, toId: print.id, amount: 60000, reason: "too much" }), "VALIDATION_ERROR");
      await budgets.transferAllocation(rep, campaignId, { fromId: media.id, toId: print.id, amount: 25000, reason: "Print ran over" });
      b = await budget();
      expect([b.allocations.find((a) => a.id === media.id)!.limit, b.allocations.find((a) => a.id === print.id)!.limit, b.totals.allocated]).toEqual([35000, 55000, 90000]);
      await expectCode(budgets.updateAllocation(rep, campaignId, print.id, { amount: 40000, version: b.allocations.find((a) => a.id === print.id)!.version }), "VALIDATION_ERROR");
      await expectCode(budgets.deleteAllocation(rep, campaignId, print.id), "REFERENCED_RECORD_IN_USE");
    });

    it("alerts are raised once for an unchanged condition and cleared when it goes away", async () => {
      await prisma.salesMarketingSettings.updateMany({ where: { companyId: rep.companyId }, data: { budgetWarnPercent: 80 } });
      // Used: 35000 actual + 18000 committed = 53000 of 100000. Push the campaign over 80%.
      const big = await exp("4", 30000);
      await budgets.linkSpend(rep, campaignId, { kind: "EXPENSE", recordId: big.id });
      const open = () => prisma.marketingBudgetAlert.findMany({ where: { campaignId, status: "OPEN" } });
      expect((await open()).map((a) => `${a.scopeKey}:${a.kind}`)).toContain("-:WARN_THRESHOLD");
      const before = await prisma.notification.count({ where: { userId: rep.userId, title: { contains: "budget alert" } } });
      await budgets.evaluateCampaignAlerts(rep.companyId, campaignId);
      await budgets.evaluateCampaignAlerts(rep.companyId, campaignId);
      expect(await prisma.notification.count({ where: { userId: rep.userId, title: { contains: "budget alert" } } })).toBe(before);
      expect((await open()).filter((a) => a.kind === "WARN_THRESHOLD" && a.scopeKey === "-").length).toBe(1);
      await budgets.unlinkSpend(rep, campaignId, { kind: "EXPENSE", recordId: big.id, reason: "Wrong campaign" });
      expect((await open()).map((a) => `${a.scopeKey}:${a.kind}`)).not.toContain("-:WARN_THRESHOLD");
      const cleared = await prisma.marketingBudgetAlert.findFirstOrThrow({ where: { campaignId, kind: "WARN_THRESHOLD", scopeKey: "-", status: "CLEARED" } });
      expect(cleared.clearedAt).not.toBeNull();
      const e = await prisma.expense.findUniqueOrThrow({ where: { id: big.id } });
      expect([e.campaignId, e.budgetAllocationId]).toEqual([null, null]);
    });

    it("overview and the campaign register use the same figures; other companies see nothing", async () => {
      const o = await budgets.budgetOverview(rep, { search: `QB-${run}` });
      const row = o.rows.find((r) => r.id === campaignId)!;
      const b = await budget();
      expect([row.actual, row.committed, row.remaining]).toEqual([b.totals.actual, b.totals.committed, b.totals.remaining]);
      await expectCode(budgets.getCampaignBudget(outsider, campaignId), "NOT_FOUND");
      await expectCode(budgets.linkSpend(outsider, campaignId, { kind: "EXPENSE", recordId: (await exp("5", 1)).id }), "NOT_FOUND");
    });
  });
});
