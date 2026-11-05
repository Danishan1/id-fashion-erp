/**
 * Sales targets, territories and team performance (Phase 05) against a real,
 * migrated + seeded Postgres database. Skipped unless CRM_IT_DATABASE_URL
 * points at a DISPOSABLE database.
 *
 * People: rep A reports to manager M (CRM tree); rep B is outside that team;
 * "admin" has view_all and prepares targets; "approver" approves. Exact
 * figures are asserted per rep / territory created by this run; company totals
 * include other test data, so only "at least" is checked there.
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

describe.skipIf(!DB_URL)("Sales performance (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const { invalidateTeamScope } = await import("@/core/hierarchy/team-scope");
  const territories = await import("./territory.service");
  const credit = await import("./sales-credit.service");
  const targets = await import("./target.service");
  const actuals = await import("./performance-actuals");
  const board = await import("./performance-board.service");
  const { periodContaining, shiftPeriod } = await import("./performance-periods");
  const orders = await import("@/modules/sales-orders/sales-order.service");
  const reports = await import("@/modules/reports/sales-performance.reports");
  const quotes = await import("@/modules/sales-marketing/quotations/quotation.service");
  const life = await import("@/modules/sales-marketing/quotations/quotation-lifecycle.service");

  const run = `p${Date.now().toString(36)}`;
  let A: Actor, B: Actor, M: Actor, admin: Actor, approver: Actor;
  let fiscal = 1;
  let T1: string, T2: string, C1: string, C2: string, C3: string, style: string, variant: string, gst5: string;
  const order: Record<string, string> = {};
  const today = new Date().toISOString().slice(0, 10);
  const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const month = () => periodContaining("MONTH", today, fiscal);
  const expectCode = (p: Promise<unknown>, code: string) =>
    code === "VALIDATION_ERROR"
      ? p.then(
          () => expect.unreachable("expected a validation error"),
          (e: { name?: string; code?: string }) => expect(e.name === "ZodError" || e.code === "VALIDATION_ERROR").toBe(true)
        )
      : expect(p).rejects.toMatchObject({ code });

  const newOrder = (actor: Actor, customerId: string, pieces: number, price: number) =>
    orders.createSalesOrder(actor, { customerId, orderDate: today, items: [{ productId: style, unitPrice: price, breakdown: [{ productVariantId: variant, orderedQuantity: pieces }] }] });

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    fiscal = company.fiscalYearStartMonth;
    await alignEnquiryCounter(prisma, company.id);
    const mkEmployee = (n: string, reportsToId?: string) => prisma.employee.create({ data: { companyId: company.id, employeeCode: `${n}-${run}`, fullName: `${n} ${run}`, reportsToId } });
    const eM = await mkEmployee("M");
    const eA = await mkEmployee("A", eM.id);
    const mk = (n: string, employeeId?: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@perf-it.local`, passwordHash: "x", fullName: `${n} ${run}`, employeeId } });
    const [a, b, m, ad, ap] = await Promise.all([mk("A", eA.id), mk("B"), mk("M", eM.id), mk("admin"), mk("approver")]);
    invalidateTeamScope();
    const actor = (id: string) => ({ companyId: company.id, userId: id, branchId: null });
    [A, B, M, admin, approver] = [actor(a.id), actor(b.id), actor(m.id), actor(ad.id), actor(ap.id)];
    viewAll.add(ad.id);
    viewAll.add(ap.id);

    C1 = (await prisma.customer.create({ data: { companyId: company.id, code: `P1-${run}`, name: `Perf One ${run}` } })).id;
    C2 = (await prisma.customer.create({ data: { companyId: company.id, code: `P2-${run}`, name: `Perf Two ${run}` } })).id;
    C3 = (await prisma.customer.create({ data: { companyId: company.id, code: `P3-${run}`, name: `Perf Three ${run}` } })).id;
    await prisma.crmCompany.create({ data: { companyId: company.id, name: `CRM Three ${run}`, nameKey: `crm three ${run}`, customerId: C3, ownerUserId: b.id, createdByUserId: b.id } as never });
    const pcs = await prisma.unitOfMeasure.findFirstOrThrow({ where: { code: "PCS" } });
    const color = await prisma.color.create({ data: { companyId: company.id, code: `C-${run}`, name: `Colour ${run}` } });
    const size = await prisma.size.create({ data: { companyId: company.id, code: `S-${run}`, name: `Size ${run}`, sortOrder: 0 } });
    style = (await prisma.product.create({ data: { companyId: company.id, styleCode: `PF-${run}`, styleName: `Perf Tee ${run}`, itemType: "STYLE", baseUomId: pcs.id } })).id;
    variant = (await prisma.productVariant.create({ data: { productId: style, colorId: color.id, sizeId: size.id, skuCode: `PF-${run}-1` } })).id;
    const taxType = await prisma.taxType.create({ data: { companyId: company.id, code: `GSTP-${run}`, name: "GST" } });
    gst5 = (await prisma.taxRate.create({ data: { companyId: company.id, taxTypeId: taxType.id, name: `GST 5% ${run}`, ratePercentage: "5", effectiveFrom: new Date("2020-01-01") } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("territories: code unique, rep assignment overlap rules, ending vs removing, one territory per customer", async () => {
    const t1 = await territories.createTerritory(admin, { code: `n-${run}`, name: `North ${run}` });
    T1 = t1!.id;
    expect(t1!.code).toBe(`N-${run}`.toUpperCase());
    await expectCode(territories.createTerritory(admin, { code: `N-${run}`, name: "dup" }), "VALIDATION_ERROR");
    T2 = (await territories.createTerritory(admin, { code: `S-${run}`, name: `South ${run}` }))!.id;

    await territories.addAssignment(admin, T1, { userId: B.userId, isPrimary: true, startDate: plusDays(-30) });
    // Same person, overlapping dates → refused; another primary overlapping → refused.
    await expectCode(territories.addAssignment(admin, T1, { userId: B.userId, isPrimary: false, startDate: plusDays(-5), endDate: plusDays(5) }), "VALIDATION_ERROR");
    await expectCode(territories.addAssignment(admin, T1, { userId: A.userId, isPrimary: true, startDate: today }), "VALIDATION_ERROR");
    // A supporting rep is fine; a future assignment can be removed, a started one only ended.
    let t = await territories.addAssignment(admin, T1, { userId: A.userId, isPrimary: false, startDate: plusDays(-1) });
    t = await territories.addAssignment(admin, T2, { userId: A.userId, isPrimary: true, startDate: plusDays(10) });
    const future = t.assignments.find((a) => a.userId === A.userId)!;
    expect(future.state).toBe("UPCOMING");
    await territories.removeAssignment(admin, T2, future.id);
    const t1Detail = await territories.getTerritory(admin, T1);
    const started = t1Detail.assignments.find((a) => a.userId === A.userId)!;
    await expectCode(territories.removeAssignment(admin, T1, started.id), "INVALID_STATE_TRANSITION");
    await expectCode(territories.endAssignment(admin, T1, started.id, { endDate: plusDays(-10) }), "VALIDATION_ERROR"); // before its start

    await territories.assignCustomers(admin, T1, { customerIds: [C1] });
    await expectCode(territories.assignCustomers(admin, T2, { customerIds: [C1] }), "VALIDATION_ERROR"); // already in North
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: C1 } })).salesTerritoryId).toBe(T1);
    const events = (await territories.getTerritory(admin, T1)).events.map((e) => e.type);
    expect(events).toEqual(expect.arrayContaining(["TERRITORY_CREATED", "REP_ASSIGNED", "CUSTOMER_ASSIGNED"]));
  });

  it("sales credit on new orders: territory primary rep, CRM owner, creator; stored territory survives a customer move", async () => {
    order.o1 = (await newOrder(A, C1, 10, 100)).id; // C1 in North, primary rep B → B / North
    order.o2 = (await newOrder(A, C2, 20, 50)).id; // no territory, no CRM owner → creator A
    order.o3 = (await newOrder(A, C3, 5, 100)).id; // CRM company owned by B → B
    const read = (id: string) => prisma.salesOrder.findUniqueOrThrow({ where: { id }, select: { salesRepUserId: true, salesTerritoryId: true, salesCreditSource: true } });
    expect(await read(order.o1)).toEqual({ salesRepUserId: B.userId, salesTerritoryId: T1, salesCreditSource: "TERRITORY_PRIMARY" });
    expect(await read(order.o2)).toEqual({ salesRepUserId: A.userId, salesTerritoryId: null, salesCreditSource: "CREATOR" });
    expect(await read(order.o3)).toEqual({ salesRepUserId: B.userId, salesTerritoryId: null, salesCreditSource: "CRM_OWNER" });

    // Moving the customer later never moves the booked order.
    await territories.assignCustomers(admin, T2, { customerIds: [C1], move: true });
    expect((await read(order.o1)).salesTerritoryId).toBe(T1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: C1 } })).salesTerritoryId).toBe(T2);

    // A customer change re-derives credit unless it was set by hand.
    const auto = await credit.creditAfterCustomerChange(prisma, A.companyId, { salesCreditSource: "CREATOR", sourceQuotationRevisionId: null, requestedByUserId: A.userId }, { customerId: C1, orderDate: today });
    expect(auto).toEqual({ salesRepUserId: A.userId, salesTerritoryId: T2, salesCreditSource: "CREATOR" }); // South has no primary rep in force
    expect(await credit.creditAfterCustomerChange(prisma, A.companyId, { salesCreditSource: "MANUAL", sourceQuotationRevisionId: null, requestedByUserId: A.userId }, { customerId: C1, orderDate: today })).toBeNull();
  });

  it("changing credit needs a reason and a real change, is logged, and marks the order MANUAL", async () => {
    await expectCode(credit.changeSalesCredit(admin, order.o2, { salesRepUserId: A.userId, salesTerritoryId: null, reason: "same" }), "VALIDATION_ERROR");
    await expectCode(credit.changeSalesCredit(admin, order.o2, { salesRepUserId: A.userId, salesTerritoryId: T2 }), "VALIDATION_ERROR");
    const c = await credit.changeSalesCredit(admin, order.o2, { salesRepUserId: A.userId, salesTerritoryId: T2, reason: "Customer is served from the South office" });
    expect(c).toMatchObject({ salesRepUserId: A.userId, salesTerritoryId: T2, source: "MANUAL", reason: "Customer is served from the South office" });
    expect(c.history[0]).toMatchObject({ type: "SALES_CREDIT_CHANGED", comment: "Customer is served from the South office" });
  });

  it("metrics: only booked orders count (draft/cancelled/held-from-draft never), invoices only when posted, quotations separately", async () => {
    const day = new Date(today);
    await prisma.salesOrder.updateMany({ where: { id: { in: [order.o1, order.o2] } }, data: { status: "CONFIRMED" } }); // o3 stays Draft
    const held = await newOrder(A, C2, 4, 25); // ₹100, held after confirming → counts
    await prisma.salesOrder.update({ where: { id: held.id }, data: { status: "ON_HOLD", statusBeforeHold: "CONFIRMED" } });
    const heldDraft = await newOrder(A, C2, 3, 1000); // held from Draft → never counts
    await prisma.salesOrder.update({ where: { id: heldDraft.id }, data: { status: "ON_HOLD", statusBeforeHold: "DRAFT" } });
    const cancelled = await newOrder(A, C2, 2, 1000);
    await prisma.salesOrder.update({ where: { id: cancelled.id }, data: { status: "CANCELLED" } });

    const m = month();
    const value = await actuals.metricTotals(A.companyId, "BOOKED_ORDER_VALUE", m.start, m.end, "REP");
    expect(value.get(A.userId)).toEqual({ value: 1100, documents: 2 }); // o2 ₹1,000 + held ₹100
    expect(value.get(B.userId)).toEqual({ value: 1000, documents: 1 }); // o1; o3 is Draft
    expect((await actuals.metricTotals(A.companyId, "BOOKED_QUANTITY", m.start, m.end, "REP")).get(A.userId)).toEqual({ value: 24, documents: 2 });
    expect((await actuals.metricTotals(A.companyId, "BOOKED_ORDER_COUNT", m.start, m.end, "REP")).get(B.userId)).toEqual({ value: 1, documents: 1 });
    const byTerritory = await actuals.metricTotals(A.companyId, "BOOKED_ORDER_VALUE", m.start, m.end, "TERRITORY");
    expect(byTerritory.get(T1)).toEqual({ value: 1000, documents: 1 });
    expect(byTerritory.get(T2)).toEqual({ value: 1000, documents: 1 }); // o2, moved by hand

    // Invoices (one active per order): posted counts (before GST), draft and cancelled don't. All credited to B.
    const inv = (n: string, status: "POSTED" | "DRAFT" | "CANCELLED", subtotal: number, salesOrderId = order.o1) =>
      prisma.salesInvoice.create({
        data: { companyId: A.companyId, invoiceNumber: `INV-${run}-${n}`, salesOrderId, customerId: C1, invoiceDate: day, dueDate: day, status, currencyCode: "INR", baseCurrencyCode: "INR", subtotalAmount: subtotal, taxAmount: subtotal * 0.05, totalAmount: subtotal * 1.05, createdByUserId: A.userId },
      });
    await inv("1", "POSTED", 600);
    await inv("2", "DRAFT", 300, order.o3);
    await inv("3", "CANCELLED", 900);
    expect((await actuals.metricTotals(A.companyId, "INVOICED_VALUE", m.start, m.end, "REP")).get(B.userId)).toEqual({ value: 600, documents: 1 });

    // An accepted quotation is its own metric — never booked sales.
    const q = await quotes.createQuotation(A, { customerId: C2, title: `${run} quote`, quotationDate: today, validUntil: plusDays(30), lines: [{ description: "Tee", quantity: 10, unitPrice: 300, taxRateId: gst5 }] } as never);
    await life.issueQuotation(A, q.id, {});
    await life.recordAcceptance(A, q.id, { decisionDate: today, method: "EMAIL", customerReference: "OK" });
    expect((await actuals.metricTotals(A.companyId, "ACCEPTED_QUOTATION_VALUE", m.start, m.end, "REP")).get(A.userId)).toEqual({ value: 3000, documents: 1 });
    expect((await actuals.metricTotals(A.companyId, "BOOKED_ORDER_VALUE", m.start, m.end, "REP")).get(A.userId)?.value).toBe(1100);
  });

  it("drill-down documents add up to the same figure as the board", async () => {
    const m = month();
    const q = { metric: "BOOKED_ORDER_VALUE", periodType: "MONTH", periodStart: m.start };
    const docs = await board.listCreditedDocuments(admin, { ...q, repId: A.userId });
    expect(docs.documents!.reduce((s, d) => s + d.value, 0)).toBe(1100);
    expect(docs.documents!.map((d) => d.kind)).toEqual(["SALES_ORDER", "SALES_ORDER"]);
    const qty = await board.listCreditedDocuments(admin, { ...q, metric: "BOOKED_QUANTITY", repId: A.userId });
    expect(qty.documents!.reduce((s, d) => s + d.value, 0)).toBe(24);
    const north = await board.listCreditedDocuments(admin, { ...q, territoryId: T1 });
    expect(north.documents!.map((d) => d.id)).toEqual([order.o1]);
    const invoiced = await board.listCreditedDocuments(admin, { ...q, metric: "INVOICED_VALUE", repId: B.userId });
    expect(invoiced.documents!.map((d) => d.value)).toEqual([600]);
    // A rep outside the viewer's team can't be drilled into.
    await expectCode(board.listCreditedDocuments(M, { ...q, repId: B.userId }), "NOT_FOUND");
  });

  it("targets: validation, duplicates, approval by someone else, revisions supersede, attainment", async () => {
    const m = month();
    const base = { scope: "REP", userId: A.userId, metric: "BOOKED_ORDER_VALUE", periodType: "MONTH", periodStart: m.start };
    await expectCode(targets.createTarget(admin, { ...base, periodStart: `${m.start.slice(0, 8)}15`, targetValue: 1 }), "VALIDATION_ERROR"); // not a period start
    const past = shiftPeriod("MONTH", today, -2, fiscal);
    await expectCode(targets.createTarget(admin, { ...base, periodStart: past.start, targetValue: 1 }), "VALIDATION_ERROR"); // ended
    await expectCode(targets.createTarget(admin, { ...base, metric: "BOOKED_ORDER_COUNT", targetValue: 2.5 }), "VALIDATION_ERROR"); // whole numbers
    await expectCode(targets.createTarget(admin, { ...base, scope: "TEAM", userId: B.userId, targetValue: 5 }), "VALIDATION_ERROR"); // B has no team

    const t = (await targets.createTarget(admin, { ...base, targetValue: 2000 }))!;
    expect(t.attainment.target).toBeNull(); // a draft is never shown as the target
    await expectCode(targets.createTarget(admin, { ...base, targetValue: 3000 }), "VALIDATION_ERROR"); // duplicate
    const r1 = t.revisions[0];
    await targets.revisionAction(admin, t.id, r1.id, "submit", {});
    await expectCode(targets.revisionAction(admin, t.id, r1.id, "approve", {}), "SELF_APPROVAL_NOT_ALLOWED");
    let d = await targets.revisionAction(approver, t.id, r1.id, "approve", { comment: "ok" });
    if ("deleted" in d) throw new Error("unexpected");
    expect(d.attainment).toMatchObject({ target: 2000, actual: 1100, gap: 900, percent: 55 });

    // Change = a new revision through approval; the old one is kept as Superseded.
    d = await targets.startNewRevision(admin, t.id);
    const r2 = d.revisions.find((r) => r.status === "DRAFT")!;
    await expectCode(targets.saveDraftRevision(admin, t.id, r2.id, { targetValue: 1000, notes: "cut", version: r2.version + 5 }), "RECORD_VERSION_CONFLICT");
    await targets.saveDraftRevision(admin, t.id, r2.id, { targetValue: 1000, notes: "cut", version: r2.version });
    await targets.revisionAction(admin, t.id, r2.id, "submit", {});
    await expectCode(targets.revisionAction(approver, t.id, r2.id, "send-back", {}), "VALIDATION_ERROR"); // reason required
    await targets.revisionAction(approver, t.id, r2.id, "send-back", { reason: "Too low" });
    await targets.revisionAction(admin, t.id, r2.id, "submit", {});
    d = await targets.revisionAction(approver, t.id, r2.id, "approve", {});
    if ("deleted" in d) throw new Error("unexpected");
    expect(d.revisions.map((r) => [r.revisionNumber, r.status])).toEqual([
      [2, "APPROVED"],
      [1, "SUPERSEDED"],
    ]);
    expect(d.attainment).toMatchObject({ target: 1000, actual: 1100, gap: -100, percent: 110 });
    expect(d.events.map((e) => e.type)).toEqual(expect.arrayContaining(["TARGET_CREATED", "SUBMITTED", "APPROVED", "SENT_BACK", "REVISION_STARTED"]));

    // Team target: manager M + A.
    const team = (await targets.createTarget(admin, { ...base, scope: "TEAM", userId: M.userId, targetValue: 4000 }))!;
    await targets.revisionAction(admin, team.id, team.revisions[0].id, "submit", {});
    const teamD = await targets.revisionAction(approver, team.id, team.revisions[0].id, "approve", {});
    if ("deleted" in teamD) throw new Error("unexpected");
    expect(teamD.attainment).toMatchObject({ target: 4000, actual: 1100, percent: 27.5 });

    // Discarding the only draft removes the target; archiving keeps it readable.
    const terr = (await targets.createTarget(admin, { scope: "TERRITORY", territoryId: T1, metric: "BOOKED_ORDER_VALUE", periodType: "MONTH", periodStart: m.start, targetValue: 500 }))!;
    expect(await targets.revisionAction(admin, terr.id, terr.revisions[0].id, "discard", {})).toEqual({ id: terr.id, deleted: true });
    const archived = await targets.archiveTarget(admin, team.id, { reason: "Team reorganised" });
    expect(archived.archived).toBe(true);
    await expectCode(targets.startNewRevision(admin, team.id), "INVALID_STATE_TRANSITION");
  });

  it("visibility: a rep sees only own / team targets and board rows; view_all sees the company", async () => {
    const m = month();
    const mine = await targets.listTargets(A, { periodStart: m.start, status: "all" });
    expect(mine.data.map((t) => t.subject)).toEqual([`A ${run}`]); // not M's team target: A is below M, not above
    const bView = await targets.listTargets(B, { periodStart: m.start, status: "all" });
    expect(bView.data.some((t) => t.subject === `A ${run}`)).toBe(false);
    const mView = await targets.listTargets(M, { periodStart: m.start, status: "all" });
    expect(mView.data.some((t) => t.subject === `A ${run}`)).toBe(true); // A reports to M
    const aTarget = mine.data.find((t) => t.subject === `A ${run}`)!;
    await expectCode(targets.getTarget(B, aTarget.id), "NOT_FOUND");

    const mBoard = await board.getPerformanceBoard(M, { metric: "BOOKED_ORDER_VALUE", periodType: "MONTH", periodStart: m.start });
    expect(mBoard.reps.map((r) => r.userId).sort()).toEqual([A.userId, M.userId].sort());
    expect(mBoard.company).toBeNull();
    expect(mBoard.teams.map((t) => t.managerId)).toEqual([M.userId]);
    expect(mBoard.teams[0]).toMatchObject({ actual: 1100, members: 2 });
    const aRow = mBoard.reps.find((r) => r.userId === A.userId)!;
    expect(aRow).toMatchObject({ actual: 1100, target: 1000, percent: 110, rank: 1 });

    const all = await board.getPerformanceBoard(admin, { metric: "BOOKED_ORDER_VALUE", periodType: "MONTH", periodStart: m.start });
    expect(all.company!.actual).toBeGreaterThanOrEqual(2100);
    expect(all.reps.some((r) => r.userId === B.userId)).toBe(true);
    expect(all.territories.find((t) => t.territoryId === T1)).toMatchObject({ actual: 1000 });
    // Team totals never double count: each order credits exactly one rep.
    const total = all.reps.reduce((s, r) => s + r.actual, 0) + all.company!.noRep.value;
    expect(Math.round(total * 100) / 100).toBe(all.company!.actual);
  });

  it("reports: target attainment and the sales credit register use the same figures and visibility", async () => {
    const m = month();
    const att = await reports.getTargetAttainmentDescriptor(A.companyId, "M", { dateFrom: m.start, dateTo: m.start, status: "all" }, { userId: M.userId });
    const aRow = att.rows.find((r) => r.subject === `A ${run}`)!;
    expect(aRow).toMatchObject({ target: 1000, actual: 1100, gap: -100, attainment: 110, status: "Approved" });
    expect(att.rows.some((r) => r.subject === `B ${run}`)).toBe(false);
    await expectCode(reports.getTargetAttainmentDescriptor(A.companyId, "M", { metric: "NOPE" }, { userId: M.userId }), "VALIDATION_ERROR");

    const reg = await reports.getSalesCreditRegisterDescriptor(A.companyId, "Admin", { dateFrom: m.start, dateTo: m.end, salesTerritoryId: T1 }, { userId: admin.userId });
    expect(reg.rows.map((r) => r.salesOrderId)).toEqual([order.o1]);
    expect(reg.rows[0]).toMatchObject({ salesRep: `B ${run}`, creditSource: "Territory's primary rep", pieces: 10, value: 1000 });
    // M sees A's (team) orders but not B's.
    const mine = await reports.getSalesCreditRegisterDescriptor(A.companyId, "M", { dateFrom: m.start, dateTo: m.end }, { userId: M.userId });
    expect(mine.rows.every((r) => r.salesRep === `A ${run}`)).toBe(true);
    expect(mine.totals).toMatchObject({ value: 1100, pieces: 24 });
  });
});
