/**
 * Sales forecast (Phase 06) against a real, migrated + seeded Postgres
 * database. Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database.
 *
 * Rep A (reports to manager M) owns every pipeline record made here, so A's
 * figures are exact; company figures include other test data ("at least").
 * All expected dates are today, so the month is always the current one.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { alignEnquiryCounter } from "../integration-test-helpers";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const viewAll = new Set<string>();
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, _module: string, action: string, ctx?: { createdBy?: string }) => {
      if (action === "view_all") return viewAll.has(userId);
      if (action === "approve" && ctx?.createdBy === userId) return false;
      return true;
    }),
    assert: vi.fn(async () => undefined),
    assertAny: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("Sales forecast (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const { invalidateTeamScope } = await import("@/core/hierarchy/team-scope");
  const forecast = await import("./forecast.service");
  const snapshots = await import("./forecast-snapshot.service");
  const scenarios = await import("./forecast-scenario.service");
  const targets = await import("@/modules/sales-marketing/performance/target.service");
  const { getSalesMarketingSettings } = await import("@/modules/sales-marketing/settings/sales-marketing-settings.service");
  const { periodContaining, shiftPeriod } = await import("@/modules/sales-marketing/performance/performance-periods");
  const orders = await import("@/modules/sales-orders/sales-order.service");
  const quotes = await import("@/modules/sales-marketing/quotations/quotation.service");
  const life = await import("@/modules/sales-marketing/quotations/quotation-lifecycle.service");
  const reports = await import("@/modules/reports/sales-forecast.reports");

  const run = `f${Date.now().toString(36)}`;
  let A: Actor, B: Actor, M: Actor, admin: Actor, approver: Actor;
  let fiscal = 1;
  let probs = { approved: 30, issued: 50, accepted: 90 };
  let C1: string, style: string, variant: string, gst5: string, bookedOrder: string;
  const ids: Record<string, string> = {};
  const today = new Date().toISOString().slice(0, 10);
  const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const month = () => periodContaining("MONTH", today, fiscal);
  const q = () => ({ periodType: "MONTH", periodStart: month().start });

  const quote = async (title: string, price: number) =>
    (await quotes.createQuotation(A, { customerId: C1, title: `${run} ${title}`, quotationDate: today, validUntil: plusDays(30), lines: [{ description: title, quantity: 10, unitPrice: price, taxRateId: gst5 }] } as never)).id;
  const opp = (n: string, data: Record<string, unknown>) =>
    prisma.crmOpportunity.create({ data: { companyId: A.companyId, opportunityNumber: `OPP-${run}-${n}`, name: `${run} ${n}`, ownerUserId: A.userId, createdByUserId: A.userId, status: "OPEN", ...data } as never });

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    fiscal = company.fiscalYearStartMonth;
    await alignEnquiryCounter(prisma, company.id);
    const s = await getSalesMarketingSettings(company.id);
    probs = { approved: s.forecastProbabilityApproved, issued: s.forecastProbabilityIssued, accepted: s.forecastProbabilityAccepted };
    const eM = await prisma.employee.create({ data: { companyId: company.id, employeeCode: `FM-${run}`, fullName: `M ${run}` } });
    const eA = await prisma.employee.create({ data: { companyId: company.id, employeeCode: `FA-${run}`, fullName: `A ${run}`, reportsToId: eM.id } });
    const mk = (n: string, employeeId?: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@fc-it.local`, passwordHash: "x", fullName: `${n} ${run}`, employeeId } });
    const [a, b, m, ad, ap] = await Promise.all([mk("A", eA.id), mk("B"), mk("M", eM.id), mk("admin"), mk("approver")]);
    invalidateTeamScope();
    const actor = (id: string) => ({ companyId: company.id, userId: id, branchId: null });
    [A, B, M, admin, approver] = [actor(a.id), actor(b.id), actor(m.id), actor(ad.id), actor(ap.id)];
    viewAll.add(ad.id);
    viewAll.add(ap.id);
    C1 = (await prisma.customer.create({ data: { companyId: company.id, code: `FC-${run}`, name: `Forecast Customer ${run}` } })).id;
    const pcs = await prisma.unitOfMeasure.findFirstOrThrow({ where: { code: "PCS" } });
    const color = await prisma.color.create({ data: { companyId: company.id, code: `FC-${run}`, name: `Colour ${run}` } });
    const size = await prisma.size.create({ data: { companyId: company.id, code: `FS-${run}`, name: `Size ${run}`, sortOrder: 0 } });
    style = (await prisma.product.create({ data: { companyId: company.id, styleCode: `FT-${run}`, styleName: `Fc Tee ${run}`, itemType: "STYLE", baseUomId: pcs.id } })).id;
    variant = (await prisma.productVariant.create({ data: { productId: style, colorId: color.id, sizeId: size.id, skuCode: `FT-${run}-1` } })).id;
    const taxType = await prisma.taxType.create({ data: { companyId: company.id, code: `GSTF-${run}`, name: "GST" } });
    gst5 = (await prisma.taxRate.create({ data: { companyId: company.id, taxTypeId: taxType.id, name: `GST 5% ${run}`, ratePercentage: "5", effectiveFrom: new Date("2020-01-01") } })).id;

    // Booked actual: one confirmed ₹1,000 order for A.
    bookedOrder = (await orders.createSalesOrder(A, { customerId: C1, orderDate: today, items: [{ productId: style, unitPrice: 100, breakdown: [{ productVariantId: variant, orderedQuantity: 10 }] }] })).id;
    await prisma.salesOrder.update({ where: { id: bookedOrder }, data: { status: "CONFIRMED" } });

    // Quotations: Q1 issued ₹1,000 (valid today); Q2 approved ₹1,000; Q3 accepted ₹2,000; Q4 issued but expired; Q5 issued ₹1,500 linked to opportunity O1 (70 %).
    ids.q1 = await quote("issued", 100);
    await life.issueQuotation(A, ids.q1, {});
    await prisma.quotationRevision.updateMany({ where: { quotationId: ids.q1 }, data: { validUntil: new Date(today) } });
    ids.q2 = await quote("approved", 100);
    await prisma.quotation.update({ where: { id: ids.q2 }, data: { status: "APPROVED" } });
    await prisma.quotationRevision.updateMany({ where: { quotationId: ids.q2 }, data: { status: "APPROVED", validUntil: new Date(today) } });
    ids.q3 = await quote("accepted", 200);
    await life.issueQuotation(A, ids.q3, {});
    await life.recordAcceptance(A, ids.q3, { decisionDate: today, method: "EMAIL", customerReference: "OK" });
    ids.q4 = await quote("expired", 100);
    await life.issueQuotation(A, ids.q4, {});
    await prisma.quotationRevision.updateMany({ where: { quotationId: ids.q4 }, data: { quotationDate: new Date(plusDays(-10)), validUntil: new Date(plusDays(-1)) } });
    ids.q5 = await quote("with opportunity", 150);
    await life.issueQuotation(A, ids.q5, {});
    const o1 = await opp("O1", { amount: 99999, probability: 70, expectedCloseDate: new Date(today) });
    await prisma.crmOpportunityErpLink.create({ data: { companyId: A.companyId, opportunityId: o1.id, docType: "QUOTATION", docId: ids.q5, docNumber: "Q5", linkedByUserId: A.userId } });
    ids.o1 = o1.id;

    // Opportunities: O2 counts (₹2,000 × 25 %); O3 no date; O4 USD; O5 overdue (₹1,000 × 40 %); O6 already ordered.
    ids.o2 = (await opp("O2", { amount: 2000, probability: 25, expectedCloseDate: new Date(today) })).id;
    ids.o3 = (await opp("O3", { amount: 500, probability: 50 })).id;
    ids.o4 = (await opp("O4", { amount: 500, probability: 50, currencyCode: "USD", expectedCloseDate: new Date(today) })).id;
    ids.o5 = (await opp("O5", { amount: 1000, probability: 40, expectedCloseDate: new Date(plusDays(-3)) })).id;
    ids.o6 = (await opp("O6", { amount: 3000, probability: 80, expectedCloseDate: new Date(today) })).id;
    await orders.createSalesOrder(A, { customerId: C1, orderDate: today, originatingOpportunityId: ids.o6, items: [{ productId: style, unitPrice: 1, breakdown: [{ productVariantId: variant, orderedQuantity: 1 }] }] });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const expectedWeighted = () => 1000 * (probs.issued / 100) + 1000 * (probs.approved / 100) + 2000 * (probs.accepted / 100) + 1500 * 0.7 + 2000 * 0.25;

  it("pipeline: quotations + opportunities, defaults vs opportunity probability, exclusions with reasons, no double count", async () => {
    const f = await forecast.getForecast(A, q());
    const mine = new Map(f.items.map((i) => [i.id, i]));
    expect(mine.get(ids.q1)).toMatchObject({ probability: probs.issued, probabilitySource: "QUOTATION_DEFAULT", value: 1000, inPeriod: true });
    expect(mine.get(ids.q2)).toMatchObject({ probability: probs.approved, value: 1000 });
    expect(mine.get(ids.q3)).toMatchObject({ probability: probs.accepted, value: 2000, expectedDate: today });
    expect(mine.get(ids.q5)).toMatchObject({ probability: 70, probabilitySource: "OPPORTUNITY", opportunityNumber: `OPP-${run}-O1` });
    expect(mine.get(ids.o2)).toMatchObject({ source: "OPPORTUNITY", weighted: 500 });
    expect(mine.get(ids.o5)).toMatchObject({ overdue: true, inPeriod: false });
    expect(mine.has(ids.o1)).toBe(false);
    const reasons = Object.fromEntries(f.excluded.map((e) => [e.id, e.reason]));
    expect(reasons).toMatchObject({ [ids.q4]: "EXPIRED", [ids.o1]: "REPRESENTED", [ids.o3]: "NO_DATE", [ids.o4]: "OTHER_CURRENCY", [ids.o6]: "ORDERED" });
    expect(f.items.find((i) => i.id === ids.q1)!.href).toBe(`/sales-marketing/quotations/${ids.q1}`);
    expect(f.warnings.map((w) => w.key)).toEqual(expect.arrayContaining(["overdue", "excluded-NO_DATE", "excluded-OTHER_CURRENCY", "excluded-EXPIRED", "default-probability"]));
    expect(f.warnings.some((w) => w.key === "excluded-REPRESENTED")).toBe(false); // de-duplication isn't a data problem
  });

  it("forecast = booked so far + weighted pipeline, per rep, team and company, in the viewer's scope", async () => {
    const f = await forecast.getForecast(A, q());
    expect(f.viewAll).toBe(false);
    expect(f.company).toBeNull();
    expect(f.me!.actual).toBe(1000);
    expect(f.me!.pipeline.weightedPipeline).toBeCloseTo(expectedWeighted(), 2);
    expect(f.me!.pipeline.forecast).toBeCloseTo(1000 + expectedWeighted(), 2);
    expect(f.me!.pipeline).toMatchObject({ items: 5, overdueItems: 1, overdueWeighted: 400 });
    const mView = await forecast.getForecast(M, q());
    expect(mView.reps.map((r) => r.key).sort()).toEqual([A.userId, M.userId].sort());
    expect(mView.teams.find((t) => t.key === M.userId)!.pipeline.forecast).toBeCloseTo(f.me!.pipeline.forecast, 2);
    const bView = await forecast.getForecast(B, q());
    expect(bView.items.some((i) => i.repUserId === A.userId)).toBe(false);
    expect(bView.reps.some((r) => r.key === A.userId)).toBe(false);
    const all = await forecast.getForecast(admin, q());
    expect(all.company!.pipeline.forecast).toBeGreaterThanOrEqual(f.me!.pipeline.forecast);
    expect(all.chart.find((c) => c.current)!.forecast).toBe(all.company!.pipeline.forecast);
  });

  it("compares with the approved Phase 05 target: gap, still needed, coverage", async () => {
    const t = (await targets.createTarget(admin, { scope: "REP", userId: A.userId, metric: "BOOKED_ORDER_VALUE", periodType: "MONTH", periodStart: month().start, targetValue: 10000 }))!;
    await targets.revisionAction(admin, t.id, t.revisions[0].id, "submit", {});
    await targets.revisionAction(approver, t.id, t.revisions[0].id, "approve", {});
    const me = (await forecast.getForecast(A, q())).me!;
    const fc = 1000 + expectedWeighted();
    expect(me.comparison).toMatchObject({ target: 10000, stillNeeded: 9000 });
    expect(me.comparison.gap).toBeCloseTo(fc - 10000, 2);
    expect(me.comparison.coverage).toBeCloseTo(Math.round((expectedWeighted() / 9000) * 100) / 100, 2);
    expect(me.targetId).toBe(t.id);
  });

  it("scenarios: hypothetical what-ifs never change records; saved ones keep assumptions and results; versions guard edits", async () => {
    const half = await scenarios.previewScenario(A, { ...q(), assumptions: { probabilityFactor: 50 } });
    expect(half.hypothetical).toBe(true);
    expect(half.me!.scenario.weightedPipeline).toBeCloseTo(expectedWeighted() / 2, 1);
    expect(half.me!.difference).toBeCloseTo(-expectedWeighted() / 2, 1);
    const overdue = await scenarios.previewScenario(A, { ...q(), assumptions: { includeOverdue: true } });
    expect(overdue.me!.scenario.weightedPipeline - overdue.me!.baseline.weightedPipeline).toBeCloseTo(400, 2);
    const slipped = await scenarios.previewScenario(A, { ...q(), assumptions: { slipDays: 40 } });
    expect(slipped.me!.scenario.weightedPipeline).toBe(0); // everything moved past this month
    await expect(scenarios.previewScenario(A, { ...q(), assumptions: { probabilityFactor: 500 } })).rejects.toMatchObject({ name: "ZodError" });
    // Source records are untouched.
    expect((await prisma.crmOpportunity.findUniqueOrThrow({ where: { id: ids.o2 } })).probability).toBe(25);

    const s = await scenarios.createScenario(A, { name: `${run} cautious`, ...q(), assumptions: { probabilityFactor: 80, trendGrowth: 5 } });
    expect(s.assumptions).toMatchObject({ probabilityFactor: 80, slipDays: 0, includeOverdue: false, trendGrowth: 5 });
    expect(s.stored).not.toBeNull();
    expect((await scenarios.getScenario(B, s.id)).stored).toBeNull(); // someone else's stored result isn't shown to a rep without view_all
    await expect(scenarios.updateScenario(A, s.id, { name: "x", assumptions: { probabilityFactor: 90 }, version: s.version + 3 })).rejects.toMatchObject({ code: "RECORD_VERSION_CONFLICT" });
    const u = await scenarios.updateScenario(A, s.id, { name: `${run} cautious 90`, assumptions: { probabilityFactor: 90 }, version: s.version });
    expect(u.version).toBe(s.version + 1);
    const arch = await scenarios.archiveScenario(A, s.id);
    expect(arch.archived).toBe(true);
    await expect(scenarios.updateScenario(A, s.id, { name: "x", assumptions: {}, version: arch.version })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("snapshots: stored as calculated and never changed by later data; automatic ones once per period; ended periods can't be snapshotted", async () => {
    const snap = await snapshots.createManualSnapshot(admin, { ...q(), note: "start" });
    const aRow = snap.reps.find((r) => r.key === A.userId)!;
    expect(aRow.pipeline.forecast).toBeCloseTo(1000 + expectedWeighted(), 2);
    expect(snap.items.included.some((i) => (i as { id?: string }).id === ids.q1)).toBe(true);
    // Cancel the booked order: the live forecast drops, the snapshot doesn't.
    await prisma.salesOrder.update({ where: { id: bookedOrder }, data: { status: "CANCELLED" } });
    expect((await forecast.getForecast(A, q())).me!.actual).toBe(0);
    expect((await snapshots.getSnapshot(admin, snap.id)).reps.find((r) => r.key === A.userId)!.pipeline.forecast).toBeCloseTo(1000 + expectedWeighted(), 2);
    // A rep only sees their own rows of a snapshot.
    const mine = await snapshots.getSnapshot(A, snap.id);
    expect(mine.company).toBeNull();
    expect(mine.reps.map((r) => r.key)).toEqual([A.userId]);
    expect(mine.items.included.every((i) => (i as { repUserId: string }).repUserId === A.userId)).toBe(true);
    await prisma.salesOrder.update({ where: { id: bookedOrder }, data: { status: "CONFIRMED" } });

    await snapshots.takeAutoSnapshotsForAllCompanies();
    const again = await snapshots.takeAutoSnapshotsForAllCompanies();
    expect(again.created).toBe(0);
    const autos = await prisma.salesForecastSnapshot.count({ where: { companyId: A.companyId, kind: "AUTO", periodType: "MONTH", periodStart: new Date(month().start) } });
    expect(autos).toBe(1);
    const past = shiftPeriod("MONTH", today, -1, fiscal);
    await expect(snapshots.createManualSnapshot(admin, { periodType: "MONTH", periodStart: past.start })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("accuracy: only ended periods with automatic snapshots; % error never divides by zero", async () => {
    // An automatic snapshot for an old month with no orders at all.
    const old = periodContaining("MONTH", "2001-03-15", fiscal);
    const exists = await prisma.salesForecastSnapshot.findFirst({ where: { companyId: A.companyId, kind: "AUTO", periodType: "MONTH", periodStart: new Date(old.start) } });
    if (!exists) {
      await prisma.salesForecastSnapshot.create({
        data: {
          companyId: A.companyId,
          kind: "AUTO",
          periodType: "MONTH",
          periodStart: new Date(old.start),
          periodEnd: new Date(old.end),
          summary: { company: { key: "COMPANY", name: "Whole company", actual: 0, pipeline: { forecast: 1234, weightedPipeline: 1234, unweightedPipeline: 2000, items: 2 }, trend: { available: false, value: null, reason: "x" }, target: null }, reps: [], teams: [], territories: [] },
        },
      });
    }
    const acc = await snapshots.getAccuracySummary(admin, { periodType: "MONTH" });
    const row = acc.periods.find((p) => p.periodStart === old.start)!;
    expect(row.pipeline).toMatchObject({ forecast: 1234, actual: 0, absoluteError: 1234, percentError: null });
    expect(row.trend).toBeNull();
    expect(acc.pipeline.periods).toBeGreaterThanOrEqual(1);
    // The current month hasn't ended, so it isn't in the accuracy list.
    expect(acc.periods.some((p) => p.periodStart === month().start)).toBe(false);
    const repAcc = await snapshots.getAccuracySummary(A, { periodType: "MONTH" });
    expect(repAcc.focus).toBe("You");
    expect(repAcc.periods.some((p) => p.periodStart === old.start)).toBe(false); // A had no row in that snapshot
  });

  it("reports: Forecast Pipeline matches the screen; Forecast Accuracy lists ended snapshots", async () => {
    const screen = await forecast.getForecast(A, q());
    const pipe = await reports.getForecastPipelineDescriptor(A.companyId, "A", { periodType: "MONTH" }, { userId: A.userId });
    expect(pipe.rows.length).toBe(screen.items.filter((i) => i.inPeriod).length);
    expect(pipe.totals!.weighted).toBeCloseTo(screen.me!.pipeline.weightedPipeline, 2);
    const left = await reports.getForecastPipelineDescriptor(A.companyId, "A", { periodType: "MONTH", show: "excluded" }, { userId: A.userId });
    expect(left.rows.map((r) => r.counted)).toEqual(expect.arrayContaining([expect.stringContaining("expired")]));
    const acc = await reports.getForecastAccuracyDescriptor(A.companyId, "Admin", { periodType: "MONTH" }, { userId: admin.userId });
    expect(acc.rows.some((r) => r.period === "Mar 2001")).toBe(true);
  });
});
