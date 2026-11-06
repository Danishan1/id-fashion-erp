/**
 * Sales Enquiries (Sales & Marketing Release 1 / S1) against a real, migrated
 * + seeded Postgres database.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database (it
 * writes users, customers, enquiries, CRM records and links):
 *   CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/sales-marketing/enquiries
 *
 * Only permissions are mocked: `view_all` is granted to the "manager" user;
 * "outsider" has no Sales & Marketing access; "nocrm" has no CRM access.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { alignEnquiryCounter } from "../integration-test-helpers";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const viewAllUsers = new Set<string>();
const noSalesUsers = new Set<string>();
const noCrmUsers = new Set<string>();
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, module: string, action: string) => {
      if (action === "view_all") return viewAllUsers.has(userId);
      if (module === "sales_marketing") return !noSalesUsers.has(userId);
      if (module === "crm") return !noCrmUsers.has(userId);
      return true;
    }),
    assert: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("Sales enquiries (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const svc = await import("./sales-enquiry.service");
  const crmCompanies = await import("@/modules/crm/companies/crm-companies.service");
  const crmContacts = await import("@/modules/crm/contacts/crm-contacts.service");
  const crmOpps = await import("@/modules/crm/opportunities/crm-opportunities.service");
  const { assertAttachmentAccess } = await import("@/core/attachments/attachment-targets");

  const run = `s${Date.now().toString(36)}`;
  let manager: Actor;
  let rep: Actor;
  let otherRep: Actor;
  let outsider: Actor;
  let noCrm: Actor;
  let customerId: string;
  let otherCustomerId: string;
  const expectCode = (p: Promise<unknown>, code: string) =>
    code === "VALIDATION_ERROR"
      ? // Input errors surface as ZodError (handleApiError maps them to 400 VALIDATION_ERROR) or as a BusinessRuleError.
        p.then(
          () => expect.unreachable("expected a validation error"),
          (e: { name?: string; code?: string }) => expect(e.name === "ZodError" || e.code === "VALIDATION_ERROR").toBe(true)
        )
      : expect(p).rejects.toMatchObject({ code });
  const sort = { sortBy: "enquiryDate" as const, sortOrder: "desc" as const };
  const page = (search?: string) => ({ skip: 0, take: 100, search });
  const ids = (r: { data: { id: string }[] }) => r.data.map((x) => x.id);
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const daysFromToday = (n: number) => iso(new Date(today.getTime() + n * 86400000));

  const create = (actor: Actor, extra: Record<string, unknown> = {}) =>
    svc.createSalesEnquiry(actor, {
      customerId,
      enquiryDate: iso(today),
      source: "EMAIL",
      subject: `${run} knit tops`,
      lines: [{ styleNameFreeText: `${run} crew neck`, targetQuantity: 1200, targetUnitPrice: 245.5, targetDeliveryDate: daysFromToday(60) }],
      ...extra,
    });

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    await alignEnquiryCounter(prisma, company.id);
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@sm-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [m, r, o, x, n] = await Promise.all([mk("manager"), mk("rep"), mk("otherrep"), mk("outsider"), mk("nocrm")]);
    const actor = (id: string) => ({ companyId: company.id, userId: id, branchId: null });
    [manager, rep, otherRep, outsider, noCrm] = [actor(m.id), actor(r.id), actor(o.id), actor(x.id), actor(n.id)];
    viewAllUsers.add(m.id);
    noSalesUsers.add(x.id);
    noCrmUsers.add(n.id);
    const mkCustomer = (k: string) => prisma.customer.create({ data: { companyId: company.id, code: `SM-${run}-${k}`, name: `Customer ${k} ${run}` } });
    customerId = (await mkCustomer("A")).id;
    otherCustomerId = (await mkCustomer("B")).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates an enquiry on the Buyer Enquiry record with sales fields, defaulting the owner to the creator", async () => {
    const e = await create(rep, { priority: "HIGH", nextFollowUpDate: daysFromToday(2) });
    const row = await prisma.buyerEnquiry.findUniqueOrThrow({ where: { id: e.id }, include: { lines: true } });
    expect(row).toMatchObject({ salesStage: "NEW", priority: "HIGH", ownerUserId: rep.userId, status: "OPEN", requestedByUserId: rep.userId });
    expect(row.enquiryNumber).toMatch(/^ENQ-/);
    expect(row.lines).toHaveLength(1);
    expect(row.lines[0].lineStatus).toBe("PENDING_REVIEW");
    expect(await prisma.auditLog.count({ where: { recordId: e.id, tableName: "buyer_enquiries", action: "CREATE" } })).toBe(1);
    // Own enquiry → no self-notification.
    expect(await prisma.notification.count({ where: { relatedRecordId: e.id } })).toBe(0);
  });

  it("assigns another owner at creation and notifies them; rejects owners without Sales & Marketing access", async () => {
    const e = await create(rep, { ownerUserId: otherRep.userId });
    expect(await prisma.notification.count({ where: { relatedRecordId: e.id, userId: otherRep.userId } })).toBe(1);
    await expectCode(create(rep, { ownerUserId: outsider.userId }), "VALIDATION_ERROR");
  });

  it("applies own/team/all visibility to list, detail and attachments", async () => {
    const mine = await create(rep);
    const theirs = await create(otherRep);
    const repList = ids(await svc.listSalesEnquiries(rep, {}, sort, page(run)));
    expect(repList).toContain(mine.id);
    expect(repList).not.toContain(theirs.id);
    expect(ids(await svc.listSalesEnquiries(manager, {}, sort, page(run)))).toEqual(expect.arrayContaining([mine.id, theirs.id]));
    await expectCode(svc.getSalesEnquiry(rep, theirs.id), "NOT_FOUND");
    await expectCode(assertAttachmentAccess(rep, "BUYER_ENQUIRY", theirs.id, "view"), "NOT_FOUND");
    await expect(assertAttachmentAccess(rep, "BUYER_ENQUIRY", mine.id, "view")).resolves.toEqual({ status: "NEW" });
    // Reassigning to otherRep hides it from rep.
    expect(await svc.assignSalesEnquiry(rep, mine.id, { ownerUserId: otherRep.userId })).toEqual({ id: mine.id, visible: false });
    await expectCode(svc.getSalesEnquiry(rep, mine.id), "NOT_FOUND");
    const detail = await svc.getSalesEnquiry(otherRep, mine.id);
    expect(detail.owner?.id).toBe(otherRep.userId);
    expect(detail.activities[0]).toMatchObject({ type: "OWNER_CHANGED" });
  });

  it("filters by view, stage, owner, priority, source, overdue and search", async () => {
    const overdue = await create(rep, { nextFollowUpDate: daysFromToday(-3), priority: "URGENT", source: "TRADE_SHOW", subject: `${run} overdue one` });
    const future = await create(rep, { nextFollowUpDate: daysFromToday(5) });
    const lost = await create(rep);
    await svc.changeSalesEnquiryStage(rep, lost.id, { stage: "LOST", reason: "Price" });

    const list = (f: Record<string, string>, search = run) => svc.listSalesEnquiries(rep, f, sort, page(search)).then(ids);
    expect(await list({ overdue: "1" })).toContain(overdue.id);
    expect(await list({ overdue: "1" })).not.toContain(future.id);
    expect(await list({})).not.toContain(lost.id); // default view = open
    expect(await list({ view: "closed" })).toContain(lost.id);
    expect(await list({ view: "closed" })).not.toContain(future.id);
    expect(await list({ stage: "LOST,NOT_A_STAGE" })).toEqual([lost.id]);
    expect(await list({ priority: "URGENT" })).toEqual([overdue.id]);
    expect(await list({ source: "TRADE_SHOW" })).toEqual([overdue.id]);
    expect(await list({ owner: "unassigned" })).toEqual([]);
    expect(await list({}, `${run} overdue`)).toEqual([overdue.id]);
    const page1 = await svc.listSalesEnquiries(rep, { overdue: "1" }, sort, page(run));
    expect(page1.data.find((r) => r.id === overdue.id)?.isOverdue).toBe(true);
  });

  it("enforces the stage machine with reasons, guarded writes and an audit trail", async () => {
    const e = await create(rep);
    await expectCode(svc.changeSalesEnquiryStage(rep, e.id, { stage: "LOST" }), "VALIDATION_ERROR");
    // System stages can't be requested by hand (schema rejects them).
    await expect(svc.changeSalesEnquiryStage(rep, e.id, { stage: "WON" })).rejects.toBeTruthy();
    await svc.changeSalesEnquiryStage(rep, e.id, { stage: "UNDER_REVIEW" });
    const q = await svc.changeSalesEnquiryStage(rep, e.id, { stage: "QUALIFIED" });
    expect(q.salesStage).toBe("QUALIFIED");
    const held = await svc.changeSalesEnquiryStage(rep, e.id, { stage: "ON_HOLD", reason: "Buyer travelling" });
    expect(held).toMatchObject({ salesStage: "ON_HOLD", stageBeforeHold: "QUALIFIED" });
    await expectCode(svc.changeSalesEnquiryStage(rep, e.id, { stage: "QUALIFIED" }), "INVALID_STATE_TRANSITION");
    const resumed = await svc.resumeSalesEnquiry(rep, e.id);
    expect(resumed).toMatchObject({ salesStage: "QUALIFIED", stageBeforeHold: null });
    await expectCode(svc.resumeSalesEnquiry(rep, e.id), "INVALID_STATE_TRANSITION");

    const nq = await svc.changeSalesEnquiryStage(rep, e.id, { stage: "NOT_QUALIFIED", reason: "Volume too small" });
    expect(nq).toMatchObject({ salesStage: "NOT_QUALIFIED", closureReason: "Volume too small" });
    expect(nq.closedAt).not.toBeNull();
    await expectCode(svc.updateSalesEnquiryDetails(rep, e.id, { subject: "x" }), "INVALID_STATE_TRANSITION");
    await expectCode(svc.reopenSalesEnquiry(rep, e.id, { reason: "" }), "VALIDATION_ERROR");
    const reopened = await svc.reopenSalesEnquiry(rep, e.id, { reason: "Buyer increased volume" });
    expect(reopened).toMatchObject({ salesStage: "UNDER_REVIEW", closedAt: null });

    const stageRows = await prisma.buyerEnquiryActivity.findMany({ where: { buyerEnquiryId: e.id, type: "STAGE_CHANGED" }, orderBy: { occurredAt: "asc" } });
    expect(stageRows.map((r) => (r.metadata as { to: string }).to)).toEqual(["UNDER_REVIEW", "QUALIFIED", "ON_HOLD", "QUALIFIED", "NOT_QUALIFIED", "UNDER_REVIEW"]);
    expect(stageRows.at(-1)?.body).toBe("Buyer increased volume");
    expect(await prisma.auditLog.count({ where: { recordId: e.id, tableName: "buyer_enquiries", action: "UPDATE" } })).toBe(6);
  });

  it("never reopens a won enquiry and refuses changes on enquiries cancelled in Merchandising", async () => {
    const won = await create(rep);
    await prisma.buyerEnquiry.update({ where: { id: won.id }, data: { salesStage: "WON" } }); // WON is set by S4 conversion
    await expectCode(svc.reopenSalesEnquiry(rep, won.id, { reason: "try again" }), "INVALID_STATE_TRANSITION");
    const cancelled = await create(rep);
    await prisma.buyerEnquiry.update({ where: { id: cancelled.id }, data: { status: "CANCELLED" } });
    await expectCode(svc.changeSalesEnquiryStage(rep, cancelled.id, { stage: "UNDER_REVIEW" }), "INVALID_STATE_TRANSITION");
    await expectCode(svc.addSalesEnquiryActivity(rep, cancelled.id, { type: "NOTE", body: "hi" }), "INVALID_STATE_TRANSITION");
    expect(await svc.listSalesEnquiries(rep, {}, sort, page(run)).then(ids)).not.toContain(cancelled.id);
  });

  it("lets only one of two concurrent closing moves win", async () => {
    const e = await create(rep);
    const results = await Promise.allSettled([
      svc.changeSalesEnquiryStage(rep, e.id, { stage: "LOST", reason: "Price" }),
      svc.changeSalesEnquiryStage(rep, e.id, { stage: "NOT_QUALIFIED", reason: "Volume" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(["RECORD_VERSION_CONFLICT", "INVALID_STATE_TRANSITION"]).toContain(rejected.reason.code);
    expect(await prisma.buyerEnquiryActivity.count({ where: { buyerEnquiryId: e.id, type: "STAGE_CHANGED" } })).toBe(1);
  });

  it("edits details, logs only real changes and follow-up moves", async () => {
    const e = await create(rep);
    await svc.updateSalesEnquiryDetails(rep, e.id, { subject: `${run} knit tops`, priority: "NORMAL" }); // no change
    expect(await prisma.buyerEnquiryActivity.count({ where: { buyerEnquiryId: e.id } })).toBe(0);
    const d = await svc.updateSalesEnquiryDetails(rep, e.id, {
      nextFollowUpDate: daysFromToday(1),
      estimatedValue: 294600,
      expectedDecisionDate: daysFromToday(20),
      nextAction: "Send costing",
      qualificationNotes: "Repeat buyer",
    });
    expect(d.estimatedValue?.toString()).toBe("294600");
    const types = (await prisma.buyerEnquiryActivity.findMany({ where: { buyerEnquiryId: e.id } })).map((a) => a.type).sort();
    expect(types).toEqual(["DETAILS_UPDATED", "FOLLOW_UP_CHANGED"]);
    const cleared = await svc.updateSalesEnquiryDetails(rep, e.id, { nextAction: "", estimatedValue: "" });
    expect(cleared).toMatchObject({ nextAction: null, estimatedValue: null });
    await expectCode(svc.updateSalesEnquiryDetails(rep, e.id, { status: "CLOSED" } as never), "VALIDATION_ERROR");
  });

  it("validates CRM company/contact links and links opportunities through the CRM link table", async () => {
    const crmA = await crmCompanies.createCompany(rep, { name: `${run} Aurora Knits` });
    const crmB = await crmCompanies.createCompany(rep, { name: `${run} Borealis Wear` });
    const contactB = await crmContacts.createContact(rep, { firstName: "Bea", lastName: run, crmCompanyId: crmB.id });
    const hiddenCompany = await crmCompanies.createCompany(otherRep, { name: `${run} Hidden Co` });
    await prisma.crmCompany.update({ where: { id: crmA.id }, data: { customerId: otherCustomerId } });

    const e = await create(rep);
    await expectCode(svc.updateSalesEnquiryDetails(rep, e.id, { crmCompanyId: crmA.id }), "VALIDATION_ERROR"); // other ERP customer
    await expectCode(svc.updateSalesEnquiryDetails(rep, e.id, { crmCompanyId: hiddenCompany.id }), "NOT_FOUND"); // outside CRM scope
    await expectCode(svc.updateSalesEnquiryDetails(rep, e.id, { crmCompanyId: crmB.id, crmContactId: contactB.id }).then(() => svc.updateSalesEnquiryDetails(rep, e.id, { crmCompanyId: crmA.id })), "VALIDATION_ERROR");
    const linked = await svc.getSalesEnquiry(rep, e.id);
    expect(linked.crmCompany?.id).toBe(crmB.id);
    expect(linked.crmContact?.id).toBe(contactB.id);
    await expectCode(create(noCrm, { crmCompanyId: crmB.id }), "PERMISSION_DENIED");

    const opp = await crmOpps.createOpportunity(rep, { name: `${run} AW27 tops`, crmCompanyId: crmB.id });
    const withOpp = await svc.linkSalesEnquiryOpportunity(rep, e.id, { opportunityId: opp.id });
    expect(withOpp.opportunities.visible.map((o) => o.opportunity.id)).toEqual([opp.id]);
    expect(await prisma.crmOpportunityErpLink.count({ where: { opportunityId: opp.id, docType: "BUYER_ENQUIRY", docId: e.id } })).toBe(1);
    await expectCode(svc.linkSalesEnquiryOpportunity(rep, e.id, { opportunityId: opp.id }), "INVALID_STATE_TRANSITION"); // duplicate
    // A user who can't see the opportunity in the CRM only gets a count.
    await svc.assignSalesEnquiry(rep, e.id, { ownerUserId: noCrm.userId });
    const asNoCrm = await svc.getSalesEnquiry(noCrm, e.id);
    expect(asNoCrm.opportunities).toEqual({ visible: [], hiddenCount: 1 });
    expect(asNoCrm.crmCompany?.name).toBe("CRM company");
    await expectCode(svc.unlinkSalesEnquiryOpportunity(noCrm, e.id, withOpp.opportunities.visible[0].linkId), "PERMISSION_DENIED");
    const unlinked = await svc.unlinkSalesEnquiryOpportunity(manager, e.id, withOpp.opportunities.visible[0].linkId);
    expect(unlinked.opportunities).toEqual({ visible: [], hiddenCount: 0 });
    const types = (await prisma.buyerEnquiryActivity.findMany({ where: { buyerEnquiryId: e.id } })).map((a) => a.type);
    expect(types).toEqual(expect.arrayContaining(["OPPORTUNITY_LINKED", "OPPORTUNITY_UNLINKED"]));
  });

  it("logs notes and interactions, but not in the future", async () => {
    const e = await create(rep);
    const call = await svc.addSalesEnquiryActivity(rep, e.id, { type: "CALL", body: "Discussed fabric GSM", occurredAt: new Date(Date.now() - 3600000).toISOString() });
    expect(call).toMatchObject({ type: "CALL", body: "Discussed fabric GSM", createdBy: { id: rep.userId } });
    await expectCode(svc.addSalesEnquiryActivity(rep, e.id, { type: "MEETING", body: "x", occurredAt: new Date(Date.now() + 86400000).toISOString() }), "VALIDATION_ERROR");
    await expectCode(svc.addSalesEnquiryActivity(rep, e.id, { type: "STAGE_CHANGED", body: "forged" } as never), "VALIDATION_ERROR");
    const timeline = await svc.getSalesEnquiryActivities(rep, e.id);
    expect(timeline.map((a) => a.id)).toEqual([call.id]);
  });

  it("does not change Merchandising's line workflow or status", async () => {
    const e = await create(rep);
    await svc.changeSalesEnquiryStage(rep, e.id, { stage: "QUALIFIED" });
    const row = await prisma.buyerEnquiry.findUniqueOrThrow({ where: { id: e.id }, include: { lines: true } });
    expect(row.status).toBe("OPEN");
    expect(row.lines.every((l) => l.lineStatus === "PENDING_REVIEW")).toBe(true);
  });

  it("lists only users with Sales & Marketing access as owners", async () => {
    const owners = (await svc.listEligibleOwners(rep)).map((u) => u.id);
    expect(owners).toEqual(expect.arrayContaining([rep.userId, otherRep.userId, manager.userId]));
    expect(owners).not.toContain(outsider.userId);
  });
});
