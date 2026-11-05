/**
 * Channels, commissions and incentives (Phase 07) against a real, migrated +
 * seeded Postgres database. Skipped unless CRM_IT_DATABASE_URL points at a
 * DISPOSABLE database.
 *
 * Months: M2 = two months ago (first statement), M1 = last month (reversal,
 * late invoice, negative month), M0 = this month (carry-forward preview).
 * Rep R earns on a progressive INVOICED plan (0 → 2 %, ₹1,00,000 → 3 %);
 * sales agent G earns 5 % of COLLECTED value. "prep" calculates / prepares,
 * "appr" approves. Exact figures are asserted for this run's payees only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

const monthOf = (offset: number) => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return d.toISOString().slice(0, 7);
};

describe.skipIf(!DB_URL)("Sales commissions (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const plans = await import("./commission-plan.service");
  const incentives = await import("./incentive-plan.service");
  const statements = await import("./commission-statement.service");
  const channels = await import("@/modules/sales-marketing/channels/sales-channel.service");
  const orders = await import("@/modules/sales-orders/sales-order.service");
  const reports = await import("@/modules/reports/sales-commissions.reports");

  const run = `c${Date.now().toString(36)}`;
  const M2 = monthOf(-2);
  const M1 = monthOf(-1);
  const M0 = monthOf(0);
  let R: Actor, prep: Actor, appr: Actor;
  let agentId: string, customerId: string, style: string, variant: string, paymentTypeId: string, channelId: string;
  const order: Record<string, string> = {};
  const inv: Record<string, string> = {};
  let repPlan: string, agentPlan: string;
  const today = new Date().toISOString().slice(0, 10);
  const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });
  const day = (m: string, d: number) => new Date(`${m}-${String(d).padStart(2, "0")}T00:00:00.000Z`);
  const stmtOf = async (month: string, payee: { userId?: string; salesAgentId?: string }) =>
    prisma.salesCommissionStatement.findFirst({ where: { companyId: R.companyId, periodStart: day(month, 1), ...payee }, include: { lines: true } });

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@comm-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [r, p, a] = await Promise.all([mk("Rep"), mk("Prep"), mk("Appr")]);
    const actor = (id: string) => ({ companyId: company.id, userId: id, branchId: null });
    [R, prep, appr] = [actor(r.id), actor(p.id), actor(a.id)];
    viewAll.add(p.id);
    viewAll.add(a.id);
    agentId = (await prisma.salesAgent.create({ data: { companyId: company.id, code: `AG-${run}`, name: `Agent ${run}` } })).id;
    customerId = (await prisma.customer.create({ data: { companyId: company.id, code: `CM-${run}`, name: `Comm Customer ${run}` } })).id;
    const pcs = await prisma.unitOfMeasure.findFirstOrThrow({ where: { code: "PCS" } });
    const color = await prisma.color.create({ data: { companyId: company.id, code: `CC-${run}`, name: `Colour ${run}` } });
    const size = await prisma.size.create({ data: { companyId: company.id, code: `CS-${run}`, name: `Size ${run}`, sortOrder: 0 } });
    style = (await prisma.product.create({ data: { companyId: company.id, styleCode: `CM-${run}`, styleName: `Comm Tee ${run}`, itemType: "STYLE", baseUomId: pcs.id } })).id;
    variant = (await prisma.productVariant.create({ data: { productId: style, colorId: color.id, sizeId: size.id, skuCode: `CM-${run}-1` } })).id;
    paymentTypeId = (await prisma.paymentType.create({ data: { companyId: company.id, code: `BK-${run}`, name: `Bank ${run}`, type: "BANK" } })).id;
    for (const k of ["o1", "o2", "o3"]) {
      order[k] = (await orders.createSalesOrder(R, { customerId, orderDate: `${M2}-05`, items: [{ productId: style, unitPrice: 100, breakdown: [{ productVariantId: variant, orderedQuantity: 10 }] }] })).id;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("channels: master, document channel / agent with history on orders, CHANNEL grouping", async () => {
    const c = await channels.createChannel(prep, { code: `ex-${run}`, name: `Export ${run}` });
    channelId = c!.id;
    await expect(channels.createChannel(prep, { code: `EX-${run}`, name: "dup" })).rejects.toBeTruthy();
    // The order needs a reason; an unchanged value is refused.
    await expectCode(channels.setDocumentChannel(prep, "SALES_ORDER", order.o1, { salesChannelId: channelId, salesAgentId: agentId }), "VALIDATION_ERROR");
    const view = await channels.setDocumentChannel(prep, "SALES_ORDER", order.o1, { salesChannelId: channelId, salesAgentId: agentId, reason: "Came through the agent" });
    expect(view.salesAgent).toContain(`Agent ${run}`);
    expect(view.history.map((h) => h.type)).toEqual(["CHANNEL_CHANGED"]);
    await expectCode(channels.setDocumentChannel(prep, "SALES_ORDER", order.o1, { salesChannelId: channelId, salesAgentId: agentId, reason: "again" }), "VALIDATION_ERROR");
    // A deactivated channel can't be newly picked.
    await channels.setChannelActive(prep, channelId, false);
    await expectCode(channels.setDocumentChannel(prep, "SALES_ORDER", order.o2, { salesChannelId: channelId, reason: "test" }), "VALIDATION_ERROR");
    await channels.setChannelActive(prep, channelId, true);
  });

  it("plans: tier validation, approval by someone else, one plan per payee at a time", async () => {
    await expectCode(
      plans.createPlan(prep, { code: `bad-${run}`, name: "Bad", payeeType: "REP", basis: "INVOICED", effectiveFrom: `${M2}-01`, method: "PERCENT", tiers: [{ from: 10, rate: 2 }] }),
      "VALIDATION_ERROR"
    ); // first tier must start at 0
    await expectCode(
      plans.createPlan(prep, { code: `bad2-${run}`, name: "Bad", payeeType: "AGENT", basis: "COLLECTED", effectiveFrom: `${M2}-01`, method: "FIXED", fixedAmount: 100 }),
      "VALIDATION_ERROR"
    ); // fixed only on invoiced
    const p = (await plans.createPlan(prep, {
      code: `rep-${run}`,
      name: `Rep plan ${run}`,
      payeeType: "REP",
      basis: "INVOICED",
      effectiveFrom: `${M2}-01`,
      method: "PERCENT",
      tierMode: "PROGRESSIVE",
      tiers: [
        { from: 0, rate: 2 },
        { from: 100000, rate: 3 },
      ],
    }))!;
    repPlan = p.id;
    const v1 = p.versions[0];
    await plans.versionAction(prep, repPlan, v1.id, "submit", {});
    await expectCode(plans.versionAction(prep, repPlan, v1.id, "approve", {}), "SELF_APPROVAL_NOT_ALLOWED");
    const approved = await plans.versionAction(appr, repPlan, v1.id, "approve", {});
    expect("versions" in approved && approved.versions[0].status).toBe("APPROVED");
    await plans.addAssignment(prep, repPlan, { userId: R.userId, startDate: `${M2}-01` });

    const a = (await plans.createPlan(prep, { code: `agt-${run}`, name: `Agent plan ${run}`, payeeType: "AGENT", basis: "COLLECTED", effectiveFrom: `${M2}-01`, method: "PERCENT", tiers: [{ from: 0, rate: 5 }] }))!;
    agentPlan = a.id;
    await plans.versionAction(prep, agentPlan, a.versions[0].id, "submit", {});
    await plans.versionAction(appr, agentPlan, a.versions[0].id, "approve", {});
    await plans.addAssignment(prep, agentPlan, { salesAgentId: agentId, startDate: `${M2}-01` });

    // R can't be on a second rep plan at the same time.
    const other = (await plans.createPlan(prep, { code: `rep2-${run}`, name: "Other", payeeType: "REP", basis: "COLLECTED", effectiveFrom: `${M2}-01`, method: "PERCENT", tiers: [{ from: 0, rate: 1 }] }))!;
    await expectCode(plans.addAssignment(prep, other.id, { userId: R.userId, startDate: today }), "VALIDATION_ERROR");
  });

  it("incentive plan: approval and a reward on the month the target period ends", async () => {
    const ip = await incentives.createIncentivePlan(prep, {
      code: `inc-${run}`,
      name: `Incentive ${run}`,
      metric: "INVOICED_VALUE",
      periodType: "MONTH",
      effectiveFrom: `${M2}-01`,
      tiers: [
        { attainment: 100, reward: 1000 },
        { attainment: 150, reward: 2500 },
      ],
      userIds: [R.userId],
    });
    await expectCode(incentives.createIncentivePlan(prep, { code: `inc2-${run}`, name: "x", metric: "INVOICED_VALUE", periodType: "MONTH", effectiveFrom: `${M2}-01`, tiers: [{ attainment: 100, reward: 500 }, { attainment: 90, reward: 900 }] }), "VALIDATION_ERROR");
    await incentives.incentivePlanAction(prep, ip.id, "submit", {});
    await expectCode(incentives.incentivePlanAction(prep, ip.id, "approve", {}), "SELF_APPROVAL_NOT_ALLOWED");
    expect((await incentives.incentivePlanAction(appr, ip.id, "approve", {})) as { status: string }).toMatchObject({ status: "APPROVED" });
    await expectCode(incentives.updateIncentivePlan(prep, ip.id, { name: "x", metric: "INVOICED_VALUE", periodType: "MONTH", effectiveFrom: `${M2}-01`, tiers: [{ attainment: 100, reward: 1 }], userIds: [], version: 99 }), "INVALID_STATE_TRANSITION");

    // An approved REP target for M2 (fixture: the target screens don't create targets for ended periods).
    await prisma.salesTarget.create({
      data: {
        companyId: R.companyId,
        scope: "REP",
        userId: R.userId,
        metric: "INVOICED_VALUE",
        periodType: "MONTH",
        periodStart: day(M2, 1),
        periodEnd: new Date(Date.UTC(Number(M2.slice(0, 4)), Number(M2.slice(5)), 0)),
        currencyCode: "INR",
        createdByUserId: prep.userId,
        revisions: { create: { revisionNumber: 1, status: "APPROVED", targetValue: 100000, createdByUserId: prep.userId, updatedByUserId: prep.userId, approvedByUserId: appr.userId, approvedAt: new Date() } },
      },
    });
  });

  it("M2: progressive commission spread over invoices, collected commission for the agent, incentive, recalculation keeps adjustments", async () => {
    const mkInv = (n: string, o: string, status: "POSTED" | "CANCELLED", subtotal: number, d: number, month = M2) =>
      prisma.salesInvoice.create({
        data: { companyId: R.companyId, invoiceNumber: `CI-${run}-${n}`, salesOrderId: o, customerId, invoiceDate: day(month, d), dueDate: day(month, d), status, currencyCode: "INR", baseCurrencyCode: "INR", subtotalAmount: subtotal, taxAmount: subtotal * 0.05, totalAmount: subtotal * 1.05, createdByUserId: R.userId },
      });
    inv.i1 = (await mkInv("1", order.o1, "POSTED", 100000, 10)).id;
    inv.i2 = (await mkInv("2", order.o2, "POSTED", 50000, 12)).id;
    await mkInv("x", order.o3, "CANCELLED", 999, 12); // cancelled never earns
    // Customer pays ₹52,500 against invoice 1 (₹1,05,000 incl. GST) → collected basis ₹50,000.
    const pay = await prisma.payment.create({
      data: { companyId: R.companyId, paymentNumber: `CP-${run}`, direction: "RECEIPT", customerId, paymentDate: day(M2, 20), paymentTypeId, amount: 52500, status: "POSTED", currencyCode: "INR", createdByUserId: R.userId, allocations: { create: { salesInvoiceId: inv.i1, allocatedAmount: 52500 } } },
    });
    expect(pay.id).toBeTruthy();

    const res = await statements.calculateStatements(prep, { month: M2 });
    expect(res.month).toBe(M2);
    let rs = (await stmtOf(M2, { userId: R.userId }))!;
    const earnings = rs.lines.filter((l) => l.kind === "EARNING").sort((a, b) => Number(b.basisAmount) - Number(a.basisAmount));
    // 1,00,000 × 2 % + 50,000 × 3 % = ₹3,500, spread by basis in paise, rounding remainder on the largest line (2,333.34 + 1,166.66).
    expect(earnings.map((l) => Number(l.amount))).toEqual([2333.34, 1166.66]);
    expect(Number(rs.earnedTotal)).toBe(3500);
    // Incentive: invoiced ₹1,50,000 vs target ₹1,00,000 = 150 % → ₹2,500 (highest tier, not added up).
    const incentive = rs.lines.find((l) => l.kind === "INCENTIVE")!;
    expect(Number(incentive.amount)).toBe(2500);
    expect((incentive.details as { attainment: number }).attainment).toBe(150);
    expect(Number(rs.netAmount)).toBe(6000);

    const gs = (await stmtOf(M2, { salesAgentId: agentId }))!;
    expect(gs.lines.map((l) => [l.kind, Number(l.basisAmount), Number(l.amount)])).toEqual([["EARNING", 50000, 2500]]);

    // Adjustment survives recalculation; recalculating gives the same statement and figures.
    await statements.addAdjustment(prep, rs.id, { amount: 100, reason: "Sample bonus" });
    await statements.calculateStatements(prep, { month: M2 });
    rs = (await stmtOf(M2, { userId: R.userId }))!;
    expect(rs.lines.filter((l) => l.kind === "ADJUSTMENT").length).toBe(1);
    expect(Number(rs.netAmount)).toBe(6100);
    expect(rs.lines.length).toBe(4);

    // Visibility: R sees only their own statement.
    const mine = await statements.listStatements(R, { month: M2 });
    expect(mine.rows.every((r) => r.payee === `Rep ${run}`)).toBe(true);
    await expectCode(statements.getStatement(R, gs.id), "NOT_FOUND");
  });

  it("M2: submit, self-approval guard, approval raises a SALES_COMMISSION payment request; frozen lines are never paid twice", async () => {
    const rs = (await stmtOf(M2, { userId: R.userId }))!;
    await statements.statementAction(prep, rs.id, "submit", {});
    await expectCode(statements.addAdjustment(prep, rs.id, { amount: 5, reason: "late" }), "INVALID_STATE_TRANSITION");
    await expectCode(statements.statementAction(prep, rs.id, "approve", {}), "SELF_APPROVAL_NOT_ALLOWED");
    const s = await statements.statementAction(appr, rs.id, "approve", {});
    expect("payment" in s && s.payment).toMatchObject({ status: "PENDING_APPROVAL", amount: 6100 });
    const pr = await prisma.paymentRequest.findFirstOrThrow({ where: { sourceModule: "SALES_COMMISSION_STATEMENT", sourceRecordId: rs.id } });
    expect(pr.requestType).toBe("SALES_COMMISSION");
    expect(pr.payToName).toBe(`Rep ${run}`);
    await expectCode(statements.statementAction(appr, rs.id, "raise-payment", {}), "INVALID_STATE_TRANSITION"); // already raised

    // A plan version starting inside an approved month is refused.
    const p = await plans.startNewVersion(prep, repPlan);
    const draft = p!.versions.find((v) => v.status === "DRAFT")!;
    await plans.saveDraftVersion(prep, repPlan, draft.id, { effectiveFrom: `${M2}-15`, method: "PERCENT", tierMode: "ALL_UNITS", tiers: [{ from: 0, rate: 10 }], version: draft.version });
    await plans.versionAction(prep, repPlan, draft.id, "submit", {});
    await expectCode(plans.versionAction(appr, repPlan, draft.id, "approve", {}), "VALIDATION_ERROR");
    await plans.versionAction(prep, repPlan, draft.id, "return-to-draft", {});
    await plans.versionAction(prep, repPlan, draft.id, "discard", {});
  });

  it("M1: cancelled invoice reverses exactly its line, a late invoice is caught up, a negative month is carried forward", async () => {
    // Invoice 2 is cancelled after M2 was approved; a late invoice dated M2 is posted now.
    await prisma.salesInvoice.update({ where: { id: inv.i2 }, data: { status: "CANCELLED" } });
    await prisma.salesInvoice.create({
      data: { companyId: R.companyId, invoiceNumber: `CI-${run}-late`, salesOrderId: order.o3, customerId, invoiceDate: day(M2, 28), dueDate: day(M2, 28), status: "POSTED", currencyCode: "INR", baseCurrencyCode: "INR", subtotalAmount: 10000, taxAmount: 500, totalAmount: 10500, createdByUserId: R.userId },
    });
    await statements.calculateStatements(prep, { month: M1 });
    const rs = (await stmtOf(M1, { userId: R.userId }))!;
    const rev = rs.lines.find((l) => l.kind === "REVERSAL")!;
    expect(Number(rev.amount)).toBe(-1166.66);
    expect(rev.eventKey.startsWith("REV:")).toBe(true);
    const late = rs.lines.find((l) => l.kind === "EARNING")!;
    expect([Number(late.basisAmount), Number(late.amount)]).toEqual([10000, 200]); // caught up at 2 %
    expect(rs.lines.filter((l) => l.eventKey === `INV:${inv.i1}`).length).toBe(0); // never twice
    expect(Number(rs.netAmount)).toBe(-966.66);

    await statements.statementAction(prep, rs.id, "submit", {});
    const approved = await statements.statementAction(appr, rs.id, "approve", {});
    expect("payment" in approved && approved.payment).toBeNull(); // nothing to pay
    await expectCode(statements.statementAction(appr, rs.id, "raise-payment", {}), "INVALID_STATE_TRANSITION");

    // This month's preview starts with the recovery; it can't be submitted before the month ends.
    await statements.calculateStatements(prep, { month: M0 });
    const now = (await stmtOf(M0, { userId: R.userId }))!;
    expect(now.lines.map((l) => [l.kind, Number(l.amount)])).toEqual([["CARRY_FORWARD", -966.66]]);
    await expectCode(statements.statementAction(prep, now.id, "submit", {}), "INVALID_STATE_TRANSITION");
    // Recalculating M1 again changes nothing (it's approved), and the reversal isn't repeated in M0.
    const again = await statements.calculateStatements(prep, { month: M1 });
    expect(again.calculated.find((c) => c.payee === `Rep ${run}`)).toBeUndefined();
    expect(now.lines.some((l) => l.kind === "REVERSAL")).toBe(false);
  });

  it("reports: commission register and sales by channel", async () => {
    const viewer = { userId: prep.userId } as never;
    const reg = await reports.getCommissionRegisterDescriptor(R.companyId, "IT", { month: M2 }, viewer);
    const mine = reg.rows.filter((r) => r.payee === `Rep ${run}`);
    expect(mine.reduce((s, r) => s + Number(r.amount), 0)).toBeCloseTo(6100, 2);
    const ch = await reports.getSalesByChannelDescriptor(R.companyId, "IT", { dateFrom: `${M2}-01`, dateTo: today }, viewer);
    const row = ch.rows.find((r) => r.channelId === channelId)!;
    expect(row.bookedValue).toBeGreaterThanOrEqual(0);
    expect(row.invoicedValue).toBe(100000); // invoice 1 is on the channel's order
  });
});
