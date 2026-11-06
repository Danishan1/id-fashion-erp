/**
 * Sales & Marketing Phase 17 — Advanced Reporting & BI against a real,
 * migrated Postgres database: every governed dataset and metric compiles and
 * runs; booked / invoiced figures (no double counting with several invoices
 * per order) reconcile with the source tables; the funnel counts each enquiry
 * once per stage; comparison periods; drill-down adds up; record scope (own vs
 * all) and tenant isolation; permission-hidden datasets and metrics; saved
 * report sharing (viewer's own permissions), versions and ownership; per-
 * recipient delivery with skips, idempotency and recipient-only, expiring
 * downloads; the schedule hook on the Phase 14 engine.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { alignEnquiryCounter } from "../integration-test-helpers";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;
delete process.env.REDIS_URL;

const denied = new Set<string>(); // "userId:module.action"
const can = async (userId: string, module: string, action: string) => !denied.has(`${userId}:${module}.${action}`);
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(can),
    assert: vi.fn(async (userId: string, module: string, action: string) => {
      if (!(await can(userId, module, action))) {
        const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
        throw new BusinessRuleError("PERMISSION_DENIED", `denied ${module}.${action}`);
      }
    }),
    assertAny: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    getViewableModules: vi.fn(async () => []),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("S&M analytics (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const engine = await import("./analytics-engine");
  const registry = await import("./analytics-registry");
  const reports = await import("./analytics-reports.service");
  const delivery = await import("./analytics-delivery.service");
  const dashboards = await import("./analytics-dashboards.service");
  const enquiries = await import("@/modules/sales-marketing/enquiries/sales-enquiry.service");
  const quotes = await import("@/modules/sales-marketing/quotations/quotation.service");
  const life = await import("@/modules/sales-marketing/quotations/quotation-lifecycle.service");
  const { invalidateTeamScope } = await import("@/core/hierarchy/team-scope");

  const run = `a${Date.now().toString(36)}`;
  let admin: Actor, rep: Actor, noAnalytics: Actor, noAccounts: Actor, outsider: Actor;
  let C1 = "", C2 = "", style = "", gst5 = "";
  const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const today = plusDays(0);
  const period = { from: plusDays(-30), to: plusDays(1) };
  const expectCode = (p: Promise<unknown>, code: string) =>
    code === "VALIDATION_ERROR"
      ? p.then(
          () => expect.unreachable("expected a validation error"),
          (e: { name?: string; code?: string }) => expect(e.name === "ZodError" || e.code === "VALIDATION_ERROR").toBe(true)
        )
      : expect(p).rejects.toMatchObject({ code });

  let n = 0;
  const order = (a: Actor, customerId: string, value: number, status: "CONFIRMED" | "DRAFT" | "CANCELLED", date = today, extra: Record<string, unknown> = {}) =>
    prisma.salesOrder.create({ data: { companyId: a.companyId, orderNumber: `ORD-${run}-${++n}`, customerId, orderDate: new Date(`${date}T00:00:00Z`), status, currencyCode: "INR", baseCurrencyCode: "INR", totalAmount: value, baseTotalAmount: value, requestedByUserId: a.userId, salesRepUserId: a.userId, ...extra } });
  const invoice = (a: Actor, salesOrderId: string, customerId: string, subtotal: number, status: "POSTED" | "DRAFT") =>
    prisma.salesInvoice.create({ data: { companyId: a.companyId, invoiceNumber: `INV-${run}-${++n}`, salesOrderId, customerId, invoiceDate: new Date(`${today}T00:00:00Z`), dueDate: new Date(`${today}T00:00:00Z`), status, currencyCode: "INR", baseCurrencyCode: "INR", subtotalAmount: subtotal, taxAmount: subtotal * 0.05, totalAmount: subtotal * 1.05, baseTotalAmount: subtotal * 1.05, createdByUserId: a.userId } });
  const q = (dataset: string, metrics: string[], extra: Record<string, unknown> = {}) => ({ dataset, metrics, ...period, ...extra });

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: `Analytics Co ${run}`, baseCurrencyCode: "INR", fiscalYearStartMonth: 4 } });
    const other = await prisma.company.create({ data: { name: `Analytics Other ${run}`, baseCurrencyCode: "INR" } });
    await alignEnquiryCounter(prisma, company.id);
    const mk = (nm: string, companyId = company.id) => prisma.user.create({ data: { companyId, email: `${nm}.${run}@an-it.local`, passwordHash: "x", fullName: `${nm} ${run}` } });
    const [a, r, na, nacc] = await Promise.all([mk("admin"), mk("rep"), mk("noanalytics"), mk("noaccounts")]);
    const actor = (id: string, companyId = company.id) => ({ companyId, userId: id, branchId: null });
    [admin, rep, noAnalytics, noAccounts] = [actor(a.id), actor(r.id), actor(na.id), actor(nacc.id)];
    outsider = actor((await mk("outsider", other.id)).id, other.id);
    // The rep sees only their own records; one user can't open Analytics; one can't see accounts.
    for (const m of ["sales_marketing", "sales_quotations", "crm"]) denied.add(`${r.id}:${m}.view_all`);
    denied.add(`${na.id}:sales_analytics.view`);
    denied.add(`${nacc.id}:accounts.view`);
    invalidateTeamScope();

    C1 = (await prisma.customer.create({ data: { companyId: company.id, code: `AN1-${run}`, name: `Analytics One ${run}` } })).id;
    C2 = (await prisma.customer.create({ data: { companyId: company.id, code: `AN2-${run}`, name: `Analytics Two ${run}` } })).id;
    const pcs = await prisma.unitOfMeasure.findFirstOrThrow({ where: { code: "PCS" } });
    style = (await prisma.product.create({ data: { companyId: company.id, styleCode: `AN-${run}`, styleName: `Analytics Tee ${run}`, itemType: "STYLE", baseUomId: pcs.id } })).id;
    const taxType = await prisma.taxType.create({ data: { companyId: company.id, code: `GSTA-${run}`, name: "GST" } });
    gst5 = (await prisma.taxRate.create({ data: { companyId: company.id, taxTypeId: taxType.id, name: `GST 5% ${run}`, ratePercentage: "5", effectiveFrom: new Date("2020-01-01") } })).id;

    // Booked: o1 ₹1,000 (admin), o2 ₹500 (rep). Never booked: draft, cancelled.
    const o1 = await order(admin, C1, 1000, "CONFIRMED");
    const o2 = await order(rep, C2, 500, "CONFIRMED");
    const draft = await order(admin, C1, 9999, "DRAFT");
    await order(admin, C1, 8888, "CANCELLED");
    // Previous period: ₹300.
    await order(admin, C1, 300, "CONFIRMED", plusDays(-45));
    // Posted invoices ₹600 + ₹400 before GST (one per order, as the ERP enforces) and a draft.
    await invoice(admin, o1.id, C1, 600, "POSTED");
    await invoice(rep, o2.id, C2, 400, "POSTED");
    await invoice(admin, draft.id, C1, 5000, "DRAFT");
    // Another company's order is never visible here.
    const oc = (await prisma.customer.create({ data: { companyId: other.id, code: `ANX-${run}`, name: `Other ${run}` } })).id;
    await order(outsider, oc, 7777, "CONFIRMED");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("every governed metric of every dataset runs (each dimension and time grain) against the real schema", async () => {
    for (const ds of Object.values(registry.DATASETS)) {
      const metrics = registry.metricsOf(ds.key).filter((m) => !m.retired).map((m) => m.id);
      for (let i = 0; i < metrics.length; i += registry.ANALYTICS_LIMITS.maxMetrics) {
        const r = await engine.runReport(admin, q(ds.key, metrics.slice(i, i + registry.ANALYTICS_LIMITS.maxMetrics)));
        expect(r.dataset.key).toBe(ds.key);
        expect(r.meta.freshness.length).toBeGreaterThan(0);
      }
      for (const d of ds.dimensions) {
        if (d.key === "period" && ds.engine === "service") continue;
        const r = await engine.runReport(admin, q(ds.key, [metrics[0]], { groupBy: [d.key], compare: "previous_period" }));
        expect(r.columns[0].key).toBe(d.key);
      }
      if (ds.engine === "sql") for (const g of Object.keys(registry.TIME_GRAINS)) await engine.runReport(admin, q(ds.key, [metrics[0]], { groupBy: ["period"], timeGrain: g }));
    }
  }, 120_000);

  it("booked and invoiced value: only booked orders and posted invoices, before / after GST, reconciled with the source", async () => {
    const o = await engine.runReport(admin, q("orders", ["booked_order_value", "booked_order_count", "avg_order_value"]));
    expect(o.totals.values).toEqual({ booked_order_value: 1500, booked_order_count: 2, avg_order_value: 750 });
    expect(o.meta.reconciliation).toMatchObject({ metricId: "booked_order_value", sourceTotal: 1500, matches: true });
    const inv = await engine.runReport(admin, q("invoices", ["invoiced_value", "invoiced_value_incl_tax", "invoice_count"]));
    expect(inv.totals.values).toEqual({ invoiced_value: 1000, invoiced_value_incl_tax: 1050, invoice_count: 2 });
    expect(inv.meta.reconciliation).toMatchObject({ sourceTotal: 1050, matches: true });
    // Grouped by customer: rows add up to the ungrouped total; labels resolved.
    const byCustomer = await engine.runReport(admin, q("orders", ["booked_order_value"], { groupBy: ["customer"] }));
    expect(byCustomer.rows.reduce((s, r) => s + (r.values.booked_order_value ?? 0), 0)).toBe(1500);
    expect(byCustomer.rows.map((r) => r.labels.customer).sort()).toEqual([`Analytics One ${run}`, `Analytics Two ${run}`]);
    expect(byCustomer.meta.metrics[0]).toMatchObject({ id: "booked_order_value", version: 1 });
  });

  it("comparison with the previous period, change %, and drill-down that adds up", async () => {
    const r = await engine.runReport(admin, q("orders", ["booked_order_value"], { compare: "previous_period" }));
    expect(r.totals.compare).toEqual({ booked_order_value: 300 });
    expect(r.totals.change).toEqual({ booked_order_value: 400 });
    const drill = await engine.drillDown(admin, q("orders", ["booked_order_value"], { groupBy: ["customer"] }), { customer: C1 });
    expect(drill.rows.map((x) => x.value)).toEqual([1000]);
    expect(drill.rows[0].href).toBe(`${registry.DATASETS.orders.drillDown!.hrefPrefix}${drill.rows[0].id}`);
  });

  it("validation: unknown or mixed-grain metrics, bad dimension, too long a range, inverted dates", async () => {
    await expectCode(engine.runReport(admin, q("orders", ["nope"])), "VALIDATION_ERROR");
    await expectCode(engine.runReport(admin, q("orders", ["booked_order_value", "invoiced_value"])), "VALIDATION_ERROR");
    await expectCode(engine.runReport(admin, q("orders", ["booked_order_value"], { groupBy: ["stage"] })), "VALIDATION_ERROR");
    await expectCode(engine.runReport(admin, { ...q("orders", ["booked_order_value"]), from: "2020-01-01", to: "2023-01-01" }), "VALIDATION_ERROR");
    await expectCode(engine.runReport(admin, { ...q("orders", ["booked_order_value"]), from: today, to: plusDays(-5) }), "VALIDATION_ERROR");
    // Free-form SQL can't even be expressed: unknown keys are refused.
    await expectCode(engine.runReport(admin, { ...q("orders", ["booked_order_value"]), sql: "select 1" }), "VALIDATION_ERROR");
    // A hostile filter value is only ever a bound parameter: no error, no rows, nothing dropped.
    const hostile = await engine.runReport(admin, q("orders", ["booked_order_value"], { filters: { customer: ["x'; drop table sales_orders; --"] } }));
    expect(hostile.totals.values.booked_order_value).toBe(0);
    expect(await prisma.salesOrder.count({ where: { companyId: admin.companyId } })).toBeGreaterThan(0);
  });

  it("permissions: Analytics access, hidden datasets, hidden metrics (never zero), tenant isolation", async () => {
    await expectCode(engine.runReport(noAnalytics, q("orders", ["booked_order_value"])), "PERMISSION_DENIED");
    await expectCode(engine.runReport(noAccounts, q("invoices", ["invoiced_value"])), "PERMISSION_DENIED");
    const f = await engine.runReport(noAccounts, q("funnel", ["funnel_received", "funnel_invoiced"]));
    expect(f.columns.map((c) => c.key)).toEqual(["funnel_received"]);
    expect(f.unavailableMetrics.map((u) => u.id)).toEqual(["funnel_invoiced"]);
    expect(f.totals.values.funnel_invoiced).toBeUndefined();
    const other = await engine.runReport(outsider, q("orders", ["booked_order_value"]));
    expect(other.totals.values.booked_order_value).toBe(7777);
    const mine = await engine.runReport(admin, q("orders", ["booked_order_value"], { filters: { customer: [C1, C2] } }));
    expect(mine.totals.values.booked_order_value).toBe(1500);
  });

  it("funnel: each enquiry counted once per stage (two quotations still one quoted enquiry); record scope own vs all", async () => {
    const mkEnq = (a: Actor, subject: string) => enquiries.createSalesEnquiry(a, { customerId: C1, enquiryDate: today, source: "EMAIL", subject: `${run} ${subject}`, lines: [{ productId: style, targetQuantity: 10 }] });
    const e1 = await mkEnq(admin, "won");
    await mkEnq(admin, "open");
    await mkEnq(rep, "rep's");
    // e1 → quotation issued and accepted → booked order with two posted invoices.
    const qt = await quotes.createQuotation(admin, { customerId: C1, buyerEnquiryId: e1.id, title: `${run} quote`, quotationDate: today, validUntil: plusDays(30), lines: [{ description: "Tee", quantity: 10, unitPrice: 100, taxRateId: gst5 }] } as never);
    await life.issueQuotation(admin, qt.id, {});
    await life.recordAcceptance(admin, qt.id, { decisionDate: today, method: "EMAIL", customerReference: "OK" });
    const rev = await prisma.quotationRevision.findFirstOrThrow({ where: { quotationId: qt.id, status: "ACCEPTED" } });
    const so = await order(admin, C1, 1000, "CONFIRMED", today, { sourceQuotationRevisionId: rev.id });
    await invoice(admin, so.id, C1, 1000, "POSTED");
    // A second quotation for the same enquiry: two issued quotations, still one quoted enquiry.
    const qt2 = await quotes.createQuotation(admin, { customerId: C1, buyerEnquiryId: e1.id, title: `${run} quote 2`, quotationDate: today, validUntil: plusDays(30), lines: [{ description: "Tee", quantity: 5, unitPrice: 100, taxRateId: gst5 }] } as never);
    await life.issueQuotation(admin, qt2.id, {});

    const all = await engine.runReport(admin, q("funnel", ["funnel_received", "funnel_quoted", "funnel_accepted", "funnel_ordered", "funnel_invoiced", "funnel_paid"]));
    expect(all.totals.values).toEqual({ funnel_received: 3, funnel_quoted: 1, funnel_accepted: 1, funnel_ordered: 1, funnel_invoiced: 1, funnel_paid: 0 });
    // The rep sees only their own enquiry.
    const own = await engine.runReport(rep, q("enquiries", ["enquiry_count"]));
    expect(own.totals.values.enquiry_count).toBe(1);
    const quoted = await engine.runReport(admin, q("quotations", ["quotation_issued_count", "quoted_value", "quotation_acceptance_rate"]));
    expect(quoted.totals.values).toEqual({ quotation_issued_count: 2, quoted_value: 1500, quotation_acceptance_rate: 100 });
    // Funnel drill: stage flags per enquiry.
    const d = await engine.drillDown(admin, q("funnel", ["funnel_received"]), {});
    expect(d.rows.find((r) => r.id === e1.id)?.flags).toMatchObject({ quoted: true, accepted: true, ordered: true, invoiced: true, paid: false });
  });

  it("saved reports: private by default, shared reports run with the viewer's permissions, versions, owner-only changes", async () => {
    const def = { query: q("invoices", ["invoiced_value"]), period: { mode: "relative", preset: "last_30_days" } };
    const r = await reports.createSavedReport(admin, { name: `Billing ${run}`, definition: def });
    expect(r).toMatchObject({ sharing: "PRIVATE", version: 1, isMine: true });
    await expectCode(reports.getSavedReport(rep, r.id), "NOT_FOUND");
    await expectCode(reports.getSavedReport(outsider, r.id), "NOT_FOUND");
    // Sharing needs .edit; sharing with someone without Analytics is refused.
    denied.add(`${admin.userId}:sales_analytics.edit`);
    await expectCode(reports.updateSavedReport(admin, r.id, { name: r.name, definition: def, sharing: "COMPANY", version: 1 }), "PERMISSION_DENIED");
    denied.delete(`${admin.userId}:sales_analytics.edit`);
    await expectCode(reports.updateSavedReport(admin, r.id, { name: r.name, definition: def, sharing: "USERS", sharedUserIds: [noAnalytics.userId], version: 1 }), "VALIDATION_ERROR");
    const shared = await reports.updateSavedReport(admin, r.id, { name: `Billing ${run} v2`, definition: def, sharing: "USERS", sharedUserIds: [rep.userId, noAccounts.userId], version: 1 });
    expect(shared.versions.map((v) => v.version)).toEqual([2, 1]);
    // Stale version → conflict; non-owner → refused.
    await expectCode(reports.updateSavedReport(admin, r.id, { name: "x y z", definition: def, version: 1 }), "RECORD_VERSION_CONFLICT");
    await expectCode(reports.updateSavedReport(rep, r.id, { name: "mine now", definition: def, version: 2 }), "PERMISSION_DENIED");
    // The rep runs it; the person without accounts access gets "denied", not the owner's numbers.
    expect((await reports.runSavedReport(rep, r.id)).result.totals.values.invoiced_value).toBe(2000);
    await expectCode(reports.runSavedReport(noAccounts, r.id), "PERMISSION_DENIED");
    expect((await reports.listSavedReports(rep)).map((x) => x.id)).toContain(r.id);
    // Run log: usage only, a denied run recorded.
    const log = await prisma.smAnalyticsRun.findMany({ where: { reportId: r.id } });
    expect(log.map((l) => l.status).sort()).toEqual(["DENIED", "OK"]);
    // Retired / invalid definitions can't be saved.
    await expectCode(reports.createSavedReport(admin, { name: `Bad ${run}`, definition: { query: q("orders", ["invoiced_value"]) } }), "VALIDATION_ERROR");
  });

  it("delivery: one copy per recipient with their own access, skips logged, idempotent, recipient-only and expiring downloads", async () => {
    const def = { query: q("invoices", ["invoiced_value"]), period: { mode: "fixed" } };
    const r = await reports.createSavedReport(admin, { name: `Delivered ${run}`, definition: def, recipientUserIds: [admin.userId, rep.userId], deliveryFormat: "CSV" });
    // Recipients without Analytics can't be chosen …
    await expectCode(reports.updateSavedReport(admin, r.id, { name: r.name, definition: def, recipientUserIds: [noAnalytics.userId], version: r.version }), "VALIDATION_ERROR");
    // … and one who loses access later is skipped at delivery time; one who can't see invoices too.
    const withAccounts = await reports.updateSavedReport(admin, r.id, { name: r.name, definition: def, recipientUserIds: [admin.userId, rep.userId, noAccounts.userId], deliveryFormat: "CSV", version: r.version });
    denied.add(`${rep.userId}:sales_analytics.view`);
    const s = await delivery.deliverSavedReport(admin, withAccounts.id, `test:${run}`);
    denied.delete(`${rep.userId}:sales_analytics.view`);
    expect(s).toEqual({ delivered: 1, skipped: 2, failed: 0, alreadyDone: 0 });
    expect(await delivery.deliverSavedReport(admin, withAccounts.id, `test:${run}`)).toEqual({ delivered: 0, skipped: 0, failed: 0, alreadyDone: 3 });
    const rows = await prisma.smAnalyticsDelivery.findMany({ where: { reportId: r.id } });
    expect(rows.map((x) => [x.recipientUserId === admin.userId ? "admin" : x.recipientUserId === rep.userId ? "rep" : "noaccounts", x.status]).sort()).toEqual([["admin", "DELIVERED"], ["noaccounts", "SKIPPED"], ["rep", "SKIPPED"]]);
    expect(rows.find((x) => x.recipientUserId === rep.userId)?.reason).toMatch(/can't open Analytics/);
    // Notified in-app, no attachment; file only for the recipient.
    expect(await prisma.notification.count({ where: { userId: admin.userId, title: { contains: `Delivered ${run}` } } })).toBe(1);
    const mine = (await delivery.listDeliveries(admin)).received.find((x) => x.reportName === `Delivered ${run}`)!;
    expect(mine.downloadable).toBe(true);
    const file = await delivery.downloadDelivery(admin, mine.id);
    const text = file.buffer.toString("utf8");
    expect(text).toContain("Period");
    expect(text).toContain("Invoiced value");
    expect(text).toContain("2000");
    await expectCode(delivery.downloadDelivery(rep, mine.id), "NOT_FOUND");
    await expectCode(delivery.downloadDelivery(outsider, mine.id), "NOT_FOUND");
    // The owner sees who was skipped, not the recipients' files.
    expect((await delivery.listDeliveries(admin)).sent.filter((x) => x.reportName === `Delivered ${run}`)).toHaveLength(3);
    // Expired → refused, and the file is purged.
    await prisma.smAnalyticsDelivery.update({ where: { id: mine.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expectCode(delivery.downloadDelivery(admin, mine.id), "INVALID_STATE_TRANSITION");
    expect(await delivery.purgeExpiredDeliveryFiles()).toBeGreaterThanOrEqual(1);
    expect((await prisma.smAnalyticsDelivery.findUniqueOrThrow({ where: { id: mine.id } })).storageKey).toBeNull();
    // Only the owner delivers.
    await expectCode(delivery.deliverSavedReport(rep, r.id, `test2:${run}`), "PERMISSION_DENIED");
  });

  it("schedules: a saved report is scheduled on the Phase 14 engine by its owner only; others' filters resolve to nothing", async () => {
    const r = await reports.createSavedReport(admin, { name: `Weekly ${run}`, definition: { query: q("orders", ["booked_order_value"]), period: { mode: "relative", preset: "last_7_days" } }, recipientUserIds: [admin.userId] });
    const s = await delivery.scheduleSavedReport(admin, r.id, { frequency: "WEEKLY", timeOfDay: "08:15", dayOfWeek: 1 });
    expect(s).toMatchObject({ entityType: "SM_ANALYTICS_REPORT", actionLabel: "Deliver report", available: true, filterQuery: `reportId=${r.id}` });
    expect((await delivery.listReportSchedules(admin, r.id)).map((x) => x.id)).toEqual([s.id]);
    await expectCode(delivery.scheduleSavedReport(rep, r.id, { frequency: "DAILY", timeOfDay: "08:15" }), "NOT_FOUND");
    const { getEntity } = await import("@/modules/bulk-actions/bulk-registry");
    const entity = getEntity("SM_ANALYTICS_REPORT")!;
    expect(await entity.resolveFilterIds(admin, { reportId: r.id }, 10)).toEqual({ ids: [r.id], total: 1 });
    expect(await entity.resolveFilterIds(rep, { reportId: r.id }, 10)).toEqual({ ids: [], total: 0 });
    // The scheduled item delivers like Send now (owner re-checked at run time).
    const handler = (await import("@/modules/bulk-actions/bulk-registry")).getHandler("SM_ANALYTICS_REPORT", "analytics_report.deliver")!;
    const out = await handler.executeItem!({ actor: admin, job: { id: "j", companyId: admin.companyId, entityType: "SM_ANALYTICS_REPORT", actionKey: "analytics_report.deliver" }, item: { id: "i", entityId: r.id, sequence: 1, attempt: 1 }, params: {}, idempotencyKey: `bulk:j-${run}:${r.id}`, keepAlive: async () => true });
    expect(out).toMatchObject({ status: "SUCCEEDED", message: "1 delivered, 0 skipped, 0 failed." });
  });

  it("dashboards: every standard dashboard runs; hidden widgets say so instead of showing zero", async () => {
    for (const d of dashboards.listDashboards()) {
      const out = await dashboards.runDashboard(admin, d.key, {});
      expect(out.widgets.every((w) => w.outcome.status === "OK")).toBe(true);
    }
    const limited = await dashboards.runDashboard(noAccounts, "executive", {});
    expect(limited.widgets.find((w) => w.id === "ex-invoiced")?.outcome.status).toBe("HIDDEN");
    expect(limited.widgets.find((w) => w.id === "ex-booked")?.outcome.status).toBe("OK");
  }, 60_000);
});
