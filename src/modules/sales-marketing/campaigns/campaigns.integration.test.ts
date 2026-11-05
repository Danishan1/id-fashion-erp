/**
 * Marketing campaigns (Phase 08) against a real, migrated + seeded Postgres
 * database. Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database.
 *
 * People: "prep" prepares (view_all), "appr" approves (view_all), "owner"
 * owns the campaign (no view_all), "outsider" sees nothing.
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

describe.skipIf(!DB_URL)("Marketing campaigns (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const svc = await import("./campaign.service");
  const results = await import("./campaign-results.service");
  const links = await import("./campaign-link.service");
  const lookups = await import("./campaign-lookup.service");
  const enquiries = await import("@/modules/sales-marketing/enquiries/sales-enquiry.service");
  const quotes = await import("@/modules/sales-marketing/quotations/quotation.service");
  const life = await import("@/modules/sales-marketing/quotations/quotation-lifecycle.service");
  const credit = await import("@/modules/sales-marketing/performance/sales-credit.service");
  const orders = await import("@/modules/sales-orders/sales-order.service");
  const leads = await import("@/modules/crm/leads/lead.service");
  const activities = await import("@/modules/crm/activities/crm-activities.service");
  const reports = await import("@/modules/reports/marketing-campaigns.reports");

  const run = `m${Date.now().toString(36)}`;
  let prep: Actor, appr: Actor, owner: Actor, outsider: Actor;
  let typeId: string, objectiveId: string, customerId: string, style: string, variant: string, gst5: string;
  let campaignId = "";
  const today = new Date().toISOString().slice(0, 10);
  const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const expectCode = (p: Promise<unknown>, code: string) =>
    code === "VALIDATION_ERROR"
      ? p.then(
          () => expect.unreachable("expected a validation error"),
          (e: { name?: string; code?: string }) => expect(e.name === "ZodError" || e.code === "VALIDATION_ERROR").toBe(true)
        )
      : expect(p).rejects.toMatchObject({ code });
  const get = () => results.getCampaign(prep, campaignId);

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    await alignEnquiryCounter(prisma, company.id);
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@cmp-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [p, a, o, x] = await Promise.all([mk("Prep"), mk("Appr"), mk("Owner"), mk("Outsider")]);
    const actor = (id: string) => ({ companyId: company.id, userId: id, branchId: null });
    [prep, appr, owner, outsider] = [actor(p.id), actor(a.id), actor(o.id), actor(x.id)];
    viewAll.add(p.id);
    viewAll.add(a.id);
    const list = await lookups.listCampaignLookups(prep, {});
    typeId = list.find((l) => l.kind === "TYPE")!.id;
    objectiveId = list.find((l) => l.kind === "OBJECTIVE")!.id;
    customerId = (await prisma.customer.create({ data: { companyId: company.id, code: `MC-${run}`, name: `Campaign Customer ${run}` } })).id;
    const pcs = await prisma.unitOfMeasure.findFirstOrThrow({ where: { code: "PCS" } });
    const color = await prisma.color.create({ data: { companyId: company.id, code: `MCC-${run}`, name: `Colour ${run}` } });
    const size = await prisma.size.create({ data: { companyId: company.id, code: `MCS-${run}`, name: `Size ${run}`, sortOrder: 0 } });
    style = (await prisma.product.create({ data: { companyId: company.id, styleCode: `MC-${run}`, styleName: `Campaign Tee ${run}`, itemType: "STYLE", baseUomId: pcs.id } })).id;
    variant = (await prisma.productVariant.create({ data: { productId: style, colorId: color.id, sizeId: size.id, skuCode: `MC-${run}-1` } })).id;
    const taxType = await prisma.taxType.create({ data: { companyId: company.id, code: `GSTM-${run}`, name: "GST" } });
    gst5 = (await prisma.taxRate.create({ data: { companyId: company.id, taxTypeId: taxType.id, name: `GST 5% ${run}`, ratePercentage: "5", effectiveFrom: new Date("2020-01-01") } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lists default types and objectives once per company", async () => {
    const again = await lookups.listCampaignLookups(prep, { kind: "TYPE" });
    expect(again.length).toBeGreaterThanOrEqual(8);
    await lookups.ensureCampaignLookups(prep.companyId);
    expect((await lookups.listCampaignLookups(prep, { kind: "TYPE" })).length).toBe(again.length);
  });

  it("create: validation, idempotent retry, unique code, visibility", async () => {
    const base = { code: `fair-${run}`, name: `Trade fair ${run}`, typeId, objectiveId, ownerUserId: owner.userId, plannedStartDate: plusDays(-3), plannedEndDate: plusDays(20), plannedBudget: 50000 };
    await expectCode(svc.createCampaign(prep, { ...base, plannedEndDate: plusDays(-10) }), "VALIDATION_ERROR");
    await expectCode(svc.createCampaign(prep, { ...base, typeId: objectiveId }), "VALIDATION_ERROR"); // an objective isn't a type
    const first = await svc.createCampaign(prep, { ...base, idempotencyKey: `key-${run}-0001` });
    const retry = await svc.createCampaign(prep, { ...base, idempotencyKey: `key-${run}-0001` });
    expect(retry).toEqual({ id: first.id, replayed: true });
    campaignId = first.id;
    await expectCode(svc.createCampaign(prep, { ...base, code: `FAIR-${run}` }), "VALIDATION_ERROR");
    expect((await results.getCampaign(owner, campaignId)).status).toBe("DRAFT"); // owner sees it
    await expectCode(results.getCampaign(outsider, campaignId), "NOT_FOUND");
    // A campaign can't be its own parent.
    const c = await get();
    await expectCode(svc.updateCampaign(prep, campaignId, { name: c.name, typeId, objectiveId, ownerUserId: owner.userId, parentCampaignId: campaignId, version: c.version }), "VALIDATION_ERROR");
  });

  it("approval: approver ≠ preparer; approved plan changes only through an approved revision", async () => {
    await svc.campaignAction(prep, campaignId, "submit", {});
    await expectCode(svc.campaignAction(prep, campaignId, "activate", {}), "INVALID_STATE_TRANSITION");
    await expectCode(svc.campaignAction(prep, campaignId, "approve", {}), "SELF_APPROVAL_NOT_ALLOWED");
    await expectCode(svc.campaignAction(appr, campaignId, "send-back", {}), "VALIDATION_ERROR"); // reason required
    await svc.campaignAction(appr, campaignId, "approve", { comment: "Go" });
    let c = await get();
    expect([c.status, c.approvedRevisionNumber, c.revisions[0].status]).toEqual(["APPROVED", 1, "APPROVED"]);

    // Dates / budget are locked; other details stay editable.
    await expectCode(svc.updateCampaign(prep, campaignId, { name: c.name, typeId, objectiveId, ownerUserId: owner.userId, plannedBudget: 99999, version: c.version }), "INVALID_STATE_TRANSITION");
    await svc.updateCampaign(prep, campaignId, { name: `${c.name} 2026`, typeId, objectiveId, ownerUserId: owner.userId, priority: "HIGH", version: c.version });

    await svc.requestPlanChange(owner, campaignId, { plannedStartDate: c.plannedStartDate, plannedEndDate: plusDays(30), plannedBudget: 80000, reason: "Bigger stand" });
    await expectCode(svc.requestPlanChange(owner, campaignId, { plannedStartDate: c.plannedStartDate, plannedEndDate: plusDays(31), plannedBudget: 90000, reason: "Again" }), "INVALID_STATE_TRANSITION"); // one pending
    c = await get();
    expect(c.plannedBudget).toBe(50000); // approved value kept until approval
    const rev = c.revisions.find((r) => r.status === "PENDING_APPROVAL")!;
    await expectCode(svc.revisionAction(owner, campaignId, rev.id, "approve", {}), "SELF_APPROVAL_NOT_ALLOWED");
    await svc.revisionAction(appr, campaignId, rev.id, "approve", {});
    c = await get();
    expect([c.plannedBudget, c.plannedEndDate, c.approvedRevisionNumber]).toEqual([80000, plusDays(30), 2]);
    expect(c.history.map((h) => h.type)).toEqual(expect.arrayContaining(["CAMPAIGN_CREATED", "SUBMITTED", "APPROVED", "REVISION_REQUESTED", "REVISION_APPROVED"]));
  });

  it("lifecycle: activate (not in the future), pause needs a reason, complete after start", async () => {
    await expectCode(svc.campaignAction(prep, campaignId, "activate", { actualStartDate: plusDays(2) }), "VALIDATION_ERROR");
    await svc.campaignAction(prep, campaignId, "activate", { actualStartDate: plusDays(-2) });
    await expectCode(svc.campaignAction(prep, campaignId, "pause", {}), "VALIDATION_ERROR");
    await svc.campaignAction(prep, campaignId, "pause", { reason: "Stand delayed" });
    await svc.campaignAction(prep, campaignId, "resume", {});
    expect((await get()).status).toBe("ACTIVE");
    await expectCode(svc.deleteCampaign(prep, campaignId), "INVALID_STATE_TRANSITION");
  });

  it("links + metrics: lead / enquiry → quotation → order carry the campaign; measured vs manual metrics", async () => {
    // Lead.
    const lead = await leads.createLead(prep, { firstName: "Camp", lastName: run, email: `camp.${run}@example.test` });
    await links.setCampaignLink(prep, "LEAD", lead.id, { campaignId });
    // Enquiry → quotation (copies the campaign) → accepted.
    const e = await enquiries.createSalesEnquiry(prep, { customerId, enquiryDate: today, source: "TRADE_SHOW", subject: `${run} enq`, lines: [{ productId: style, targetQuantity: 50 }] });
    await links.setCampaignLink(prep, "ENQUIRY", e.id, { campaignId });
    const prefill = await quotes.getQuotationPrefillFromEnquiry(prep, e.id);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { enquiryNumber, customerName, ...body } = prefill;
    const q = await quotes.createQuotation(prep, { ...body, lines: [{ ...body.lines[0], quantity: 10, unitPrice: 300, taxRateId: gst5 }] } as never);
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } })).campaignId).toBe(campaignId);
    await life.issueQuotation(prep, q.id, {});
    await life.recordAcceptance(prep, q.id, { decisionDate: today, method: "EMAIL", customerReference: "OK" });
    // An order converted from that quotation starts with its campaign.
    const rev = await prisma.quotationRevision.findFirstOrThrow({ where: { quotationId: q.id, status: "ACCEPTED" } });
    expect((await credit.resolveDefaultChannel(prisma, prep.companyId, rev.id)).campaignId).toBe(campaignId);
    // A booked order linked by hand (needs a reason), counted by the Phase 05 rule.
    const o = await orders.createSalesOrder(prep, { customerId, orderDate: today, items: [{ productId: style, unitPrice: 100, breakdown: [{ productVariantId: variant, orderedQuantity: 25 }] }] });
    await expectCode(links.setCampaignLink(prep, "SALES_ORDER", o.id, { campaignId }), "VALIDATION_ERROR");
    const linked = await links.setCampaignLink(prep, "SALES_ORDER", o.id, { campaignId, reason: "Order taken at the fair" });
    expect(linked.history.map((h) => h.type)).toEqual(["CAMPAIGN_CHANGED"]);
    await prisma.salesOrder.update({ where: { id: o.id }, data: { status: "CONFIRMED" } });
    // A draft campaign can't take links.
    const draft = await svc.createCampaign(prep, { code: `d-${run}`, name: "Draft", typeId, objectiveId, ownerUserId: owner.userId, plannedStartDate: today, plannedEndDate: today });
    await expectCode(links.setCampaignLink(prep, "ENQUIRY", e.id, { campaignId: draft.id }), "VALIDATION_ERROR");
    await svc.deleteCampaign(prep, draft.id);

    for (const [systemKey, targetValue] of [["LEADS", 10], ["ENQUIRIES", 5], ["ACCEPTED_QUOTATION_VALUE", 10000], ["BOOKED_ORDER_VALUE", 5000]] as const) {
      await results.addMetric(prep, campaignId, { source: "SYSTEM", systemKey, targetValue });
    }
    await expectCode(results.addMetric(prep, campaignId, { source: "SYSTEM", systemKey: "LEADS" }), "VALIDATION_ERROR");
    await results.addMetric(prep, campaignId, { source: "MANUAL", label: "Booth visitors", unit: "COUNT", targetValue: 300 });
    let c = await get();
    const manual = c.metrics.find((m) => m.source === "MANUAL")!;
    await expectCode(results.recordManualResult(prep, campaignId, c.metrics[0].id, { actual: 5, asOf: today }), "VALIDATION_ERROR"); // measured ones can't be typed
    await results.recordManualResult(owner, campaignId, manual.id, { actual: 240, asOf: today });
    c = await get();
    const by = Object.fromEntries(c.metrics.map((m) => [m.label, [m.actual, m.percentOfTarget]]));
    expect(by).toMatchObject({ Leads: [1, 10], "Sales enquiries": [1, 20], "Accepted quotation value": [3000, 30], "Booked order value": [2500, 50], "Booth visitors": [240, 80] });
    expect(c.metrics.find((m) => m.label === "Booth visitors")!.provenance).toContain(`Owner ${run}`);
    expect(c.links.leads!.length).toBe(1);
  });

  it("budget: linked expenses — approved count as spend, pending shown apart; one campaign per expense", async () => {
    const mkExp = (n: string, status: "APPROVED" | "PENDING_APPROVAL" | "REJECTED", amount: number) =>
      prisma.expense.create({ data: { companyId: prep.companyId, expenseNumber: `EX-${run}-${n}`, expenseDate: new Date(`${today}T00:00:00Z`), description: `Stand ${n}`, amount, taxAmount: amount * 0.18, totalAmount: amount * 1.18, currencyCode: "INR", status, createdByUserId: prep.userId } });
    const [a, b, r] = [await mkExp("1", "APPROVED", 30000), await mkExp("2", "PENDING_APPROVAL", 12000), await mkExp("3", "REJECTED", 999)];
    await results.linkExpense(prep, campaignId, { expenseId: a.id });
    await results.linkExpense(prep, campaignId, { expenseId: b.id });
    await expectCode(results.linkExpense(prep, campaignId, { expenseId: r.id }), "VALIDATION_ERROR");
    await expectCode(results.linkExpense(prep, campaignId, { expenseId: a.id }), "VALIDATION_ERROR");
    let c = await get();
    expect([c.budget.planned, c.budget.actual, c.budget.pending, c.budget.remaining]).toEqual([80000, 30000, 12000, 50000]);
    await results.unlinkExpense(prep, campaignId, b.id, { reason: "Wrong campaign" });
    c = await get();
    expect(c.budget.pending).toBe(0);
    const reg = await reports.getCampaignRegisterDescriptor(prep.companyId, "IT", {}, { userId: prep.userId } as never);
    expect(reg.rows.find((x) => x.campaignId === campaignId)).toMatchObject({ plannedBudget: 80000, actualSpend: 30000, remaining: 50000 });
  });

  it("milestones are CRM tasks on the campaign; overdue counted; cancel closes the campaign", async () => {
    await results.addMilestone(prep, campaignId, { subject: "Catalogue approved", dueDate: plusDays(-1) });
    const task = await activities.createActivity(prep, { type: "TASK", subject: "Book hotel", entityType: "CAMPAIGN", entityId: campaignId, dueDate: plusDays(5) });
    expect(task.links.some((l: { entityType: string }) => l.entityType === "CAMPAIGN")).toBe(true);
    // Outsider can't see the campaign, so can't add activities to it.
    await expectCode(activities.createActivity(outsider, { type: "TASK", subject: "x", entityType: "CAMPAIGN", entityId: campaignId }), "VALIDATION_ERROR");
    let c = await get();
    expect(c.milestones.map((m) => m.subject)).toEqual(["Catalogue approved"]);
    expect([c.progress.total, c.progress.overdue, c.progress.milestones]).toEqual([2, 1, 1]);
    const cal = await results.campaignCalendar(prep, { month: today.slice(0, 7) });
    expect(cal.campaigns.some((x) => x.id === campaignId)).toBe(true);
    const res = await reports.getCampaignResultsDescriptor(prep.companyId, "IT", {}, { userId: prep.userId } as never);
    expect(res.rows.filter((x) => x.campaignId === campaignId).length).toBe(5);

    await svc.campaignAction(prep, campaignId, "cancel", { reason: "Fair cancelled" });
    c = await get();
    expect([c.status, c.actualEndDate]).toEqual(["CANCELLED", today]);
    await expectCode(activities.createActivity(prep, { type: "TASK", subject: "late", entityType: "CAMPAIGN", entityId: campaignId }), "VALIDATION_ERROR");
  });
});
