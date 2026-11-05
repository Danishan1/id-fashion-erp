/**
 * Sales & Marketing KPIs and reports (Release 1 / S6) against a real,
 * migrated + seeded Postgres database. Skipped unless CRM_IT_DATABASE_URL
 * points at a DISPOSABLE database.
 *
 * "rep" / "rep2" see only their own records (no view_all); "manager" sees
 * everything. Exact figures are asserted for rep (only this run's records are
 * in rep's scope); the manager's figures include other test data, so only
 * "at least" is checked for them.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { alignEnquiryCounter } from "./integration-test-helpers";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const viewAll = new Set<string>();
const noOrders = new Set<string>();
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, module: string, action: string) => {
      if (action === "view_all") return viewAll.has(userId);
      if (module === "sales_orders") return !noOrders.has(userId);
      return true;
    }),
    assert: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("Sales & Marketing KPIs and reports (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const metrics = await import("./sales-marketing-metrics.service");
  const enquiries = await import("./enquiries/sales-enquiry.service");
  const quotes = await import("./quotations/quotation.service");
  const life = await import("./quotations/quotation-lifecycle.service");
  const reports = await import("@/modules/reports/sales-marketing.reports");

  const run = `k${Date.now().toString(36)}`;
  let rep: Actor, rep2: Actor, manager: Actor;
  let customer: string, gst5: string, convertedOrder: string;
  const ids: Record<string, string> = {};
  const today = new Date().toISOString().slice(0, 10);
  const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const viewer = (a: Actor) => ({ userId: a.userId });

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    await alignEnquiryCounter(prisma, company.id);
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@s6-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [r, r2, m] = await Promise.all([mk("rep"), mk("rep2"), mk("manager")]);
    const actor = (id: string) => ({ companyId: company.id, userId: id, branchId: null });
    [rep, rep2, manager] = [actor(r.id), actor(r2.id), actor(m.id)];
    viewAll.add(m.id);
    customer = (await prisma.customer.create({ data: { companyId: company.id, code: `S6-${run}`, name: `KPI Customer ${run}` } })).id;
    const taxType = await prisma.taxType.create({ data: { companyId: company.id, code: `GSTK-${run}`, name: "GST" } });
    gst5 = (await prisma.taxRate.create({ data: { companyId: company.id, taxTypeId: taxType.id, name: `GST 5% ${run}`, ratePercentage: "5", effectiveFrom: new Date("2020-01-01") } })).id;

    // Enquiries: E1 overdue follow-up and quoted (→ Quoted); E2 qualified, not quoted; rep2 has one New enquiry.
    const e1 = await enquiries.createSalesEnquiry(rep, { customerId: customer, enquiryDate: today, source: "EMAIL", subject: `${run} e1`, lines: [{ styleNameFreeText: "Tee", targetQuantity: 100 }] });
    const e2 = await enquiries.createSalesEnquiry(rep, { customerId: customer, enquiryDate: today, source: "PHONE", subject: `${run} e2`, lines: [{ styleNameFreeText: "Hood", targetQuantity: 50 }] });
    await prisma.buyerEnquiry.update({ where: { id: e1.id }, data: { nextFollowUpDate: new Date(plusDays(-2)) } });
    await enquiries.changeSalesEnquiryStage(rep, e2.id, { stage: "QUALIFIED" });
    ids.e1 = e1.id;
    ids.e2 = e2.id;
    await enquiries.createSalesEnquiry(rep2, { customerId: customer, enquiryDate: today, source: "EMAIL", subject: `${run} other`, lines: [{ styleNameFreeText: "Cap", targetQuantity: 10 }] });

    const body = (title: string, price: number) => ({ customerId: customer, title: `${run} ${title}`, quotationDate: today, validUntil: plusDays(30), lines: [{ description: title, quantity: 10, unitPrice: price, taxRateId: gst5 }] });
    // Q1 draft (₹1,050), Q2 issued from E1 (₹2,100), Q3 issued then expired (₹3,150), Q4 accepted + converted (₹4,200), Q5 rejected (₹5,250).
    ids.q1 = (await quotes.createQuotation(rep, body("draft", 100))).id;
    const prefill = await quotes.getQuotationPrefillFromEnquiry(rep, e1.id);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { enquiryNumber, customerName, ...pf } = prefill;
    ids.q2 = (await quotes.createQuotation(rep, { ...pf, title: `${run} issued`, lines: [{ description: "issued", quantity: 10, unitPrice: 200, taxRateId: gst5 }] } as never)).id;
    await life.issueQuotation(rep, ids.q2, {});
    ids.q3 = (await quotes.createQuotation(rep, body("expired", 300))).id;
    await life.issueQuotation(rep, ids.q3, {});
    await prisma.quotationRevision.updateMany({ where: { quotationId: ids.q3 }, data: { quotationDate: new Date(plusDays(-10)), validUntil: new Date(plusDays(-1)) } });
    ids.q4 = (await quotes.createQuotation(rep, body("won", 400))).id;
    await life.issueQuotation(rep, ids.q4, {});
    await life.recordAcceptance(rep, ids.q4, { decisionDate: today, method: "PURCHASE_ORDER", customerReference: "PO-S6" });
    const rev4 = await prisma.quotationRevision.findFirstOrThrow({ where: { quotationId: ids.q4 } });
    convertedOrder = (
      await prisma.salesOrder.create({
        data: { companyId: company.id, orderNumber: `ORD-${run}`, customerId: customer, orderDate: new Date(today), currencyCode: "INR", baseCurrencyCode: "INR", totalAmount: 4000, baseTotalAmount: 4000, requestedByUserId: rep.userId, sourceQuotationRevisionId: rev4.id },
      })
    ).id;
    await prisma.quotation.update({ where: { id: ids.q4 }, data: { status: "CONVERTED" } });
    ids.q5 = (await quotes.createQuotation(rep, body("lost", 500))).id;
    await life.issueQuotation(rep, ids.q5, {});
    await life.recordRejection(rep, ids.q5, { decisionDate: today, reason: "Price too high" });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("dashboard KPIs: exact figures in the rep's own scope", async () => {
    const m = await metrics.getSalesMarketingMetrics(rep, 30);
    expect(m.periodDays).toBe(30);
    expect(m.enquiries).toEqual({ open: 2, overdueFollowUps: 1, awaitingQualification: 0, receivedInPeriod: 2, quotedInPeriod: 1, quotationRate: 50 });
    const by = Object.fromEntries(m.quotations!.byStatus.map((s) => [s.key, [s.count, s.value]]));
    expect(by).toEqual({ DRAFT: [1, 1050], PENDING_APPROVAL: [0, 0], APPROVED: [0, 0], ISSUED: [1, 2100], EXPIRED: [1, 3150], ACCEPTED: [0, 0] });
    expect(m.quotations!.decisions).toEqual({ accepted: 1, rejected: 1, winRate: 50 });
    expect(m.quotations!.conversion).toEqual({ accepted: 1, converted: 1, rate: 100 });
    expect(m.quotations!.topCustomers).toEqual([{ customerId: customer, name: `KPI Customer ${run}`, accepted: 1, value: 4200 }]);
    expect(m.orders!.count).toBeGreaterThanOrEqual(1);
  });

  it("dashboard KPIs: another rep sees none of it; the manager sees at least as much; no order figures without order access", async () => {
    const other = await metrics.getSalesMarketingMetrics(rep2, 30);
    expect(other.enquiries).toMatchObject({ open: 1, overdueFollowUps: 0, awaitingQualification: 1 }); // still New
    expect(other.quotations!.byStatus.every((s) => s.count === 0)).toBe(true);
    expect(other.quotations!.decisions.winRate).toBeNull();
    const mgr = await metrics.getSalesMarketingMetrics(manager, 30);
    expect(mgr.enquiries!.open).toBeGreaterThanOrEqual(3);
    expect(mgr.quotations!.decisions.accepted).toBeGreaterThanOrEqual(1);
    noOrders.add(rep.userId);
    try {
      expect((await metrics.getSalesMarketingMetrics(rep, 30)).orders).toBeNull();
    } finally {
      noOrders.delete(rep.userId);
    }
  });

  it("Enquiry Register: own scope, filters, overdue flag, quotation counts", async () => {
    const d = await reports.getEnquiryRegisterDescriptor(rep.companyId, "Rep", { customerId: customer }, viewer(rep));
    expect(d.rows.map((r) => r.enquiryId).sort()).toEqual([ids.e1, ids.e2].sort());
    const e1 = d.rows.find((r) => r.enquiryId === ids.e1)!;
    expect(e1).toMatchObject({ overdue: "Overdue", quotations: 1, source: "Email", party: `KPI Customer ${run}` });
    expect((await reports.getEnquiryRegisterDescriptor(rep.companyId, "Rep", { customerId: customer, stage: "QUALIFIED" }, viewer(rep))).rows.map((r) => r.enquiryId)).toEqual([ids.e2]);
    expect((await reports.getEnquiryRegisterDescriptor(rep.companyId, "Rep2", { customerId: customer }, viewer(rep2))).rows).toHaveLength(1);
    expect((await reports.getEnquiryRegisterDescriptor(rep.companyId, "M", { customerId: customer }, viewer(manager))).rows).toHaveLength(3);
    await expect(reports.getEnquiryRegisterDescriptor(rep.companyId, "Rep", { stage: "BOGUS" }, viewer(rep))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("Quotation Register: current revision, expired vs issued, totals over the filtered set", async () => {
    const d = await reports.getQuotationRegisterDescriptor(rep.companyId, "Rep", { customerId: customer }, viewer(rep));
    expect(d.rows).toHaveLength(5);
    expect(Object.fromEntries(d.rows.map((r) => [r.quotationId, r.status]))).toEqual({ [ids.q1]: "Draft", [ids.q2]: "Issued", [ids.q3]: "Expired", [ids.q4]: "Converted", [ids.q5]: "Rejected" });
    expect(d.totals).toMatchObject({ taxable: 15000, gst: 750, total: 15750 });
    const expired = await reports.getQuotationRegisterDescriptor(rep.companyId, "Rep", { customerId: customer, status: "EXPIRED" }, viewer(rep));
    expect(expired.rows.map((r) => r.quotationId)).toEqual([ids.q3]);
    const issued = await reports.getQuotationRegisterDescriptor(rep.companyId, "Rep", { customerId: customer, status: "ISSUED" }, viewer(rep));
    expect(issued.rows.map((r) => r.quotationId)).toEqual([ids.q2]);
    expect((await reports.getQuotationRegisterDescriptor(rep.companyId, "Rep", { customerId: customer, dateFrom: plusDays(1) }, viewer(rep))).rows).toHaveLength(0);
    expect((await reports.getQuotationRegisterDescriptor(rep.companyId, "Rep2", { customerId: customer }, viewer(rep2))).rows).toHaveLength(0);
    await expect(reports.getQuotationRegisterDescriptor(rep.companyId, "Rep", { status: "NOPE" }, viewer(rep))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("Quotation → Order Conversion: accepted revisions with their order; order hidden without order access", async () => {
    const d = await reports.getQuotationConversionDescriptor(rep.companyId, "Rep", { customerId: customer }, viewer(rep));
    expect(d.rows).toEqual([
      expect.objectContaining({ quotationId: ids.q4, result: "Converted", customerReference: "PO-S6", quotedTaxable: 4000, salesOrderId: convertedOrder, orderNumber: `ORD-${run}`, orderValue: 4000, daysToConvert: 0 }),
    ]);
    expect(String(d.totals!.quotationNumber)).toBe("1 accepted · 1 converted · 100%");
    expect((await reports.getQuotationConversionDescriptor(rep.companyId, "Rep", { customerId: customer, result: "pending" }, viewer(rep))).rows).toHaveLength(0);
    noOrders.add(rep.userId);
    try {
      const hidden = await reports.getQuotationConversionDescriptor(rep.companyId, "Rep", { customerId: customer }, viewer(rep));
      expect(hidden.rows[0]).toMatchObject({ result: "Converted", orderNumber: "(no access)", salesOrderId: null, orderValue: null });
    } finally {
      noOrders.delete(rep.userId);
    }
    expect((await reports.getQuotationConversionDescriptor(rep.companyId, "Rep2", { customerId: customer }, viewer(rep2))).rows).toHaveLength(0);
  });
});
