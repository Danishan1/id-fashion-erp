/**
 * CRM Opportunities (Phase 06) against a real, migrated + seeded Postgres
 * database.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database (it
 * writes opportunities, companies, contacts, leads, users and test ERP
 * customers / sales orders / buyer enquiries):
 *   CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/crm/opportunities/opportunity.integration.test.ts
 *
 * Only permissions are mocked: `crm.view_all` is granted to the "manager"
 * test user and denied to the "rep" users; ERP sales-order access is denied
 * to users in `noSalesUsers`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const viewAllUsers = new Set<string>();
const noSalesUsers = new Set<string>();
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, module: string, action: string) => {
      if (action === "view_all") return viewAllUsers.has(userId);
      if (module === "sales_orders") return !noSalesUsers.has(userId);
      return true;
    }),
    assert: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("CRM opportunities (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const opps = await import("./crm-opportunities.service");
  const erp = await import("./crm-opportunity-erp.service");
  const companies = await import("../companies/crm-companies.service");
  const relations = await import("../companies/company-relations.service");
  const contacts = await import("../contacts/crm-contacts.service");
  const leads = await import("../leads/lead.service");
  const notes = await import("../notes/crm-notes.service");
  const documents = await import("../documents/crm-documents.service");
  const pipelines = await import("../pipelines/crm-pipelines.service");
  const events = await import("../core/crm-events.service");
  const access = await import("../crm-entity-access");
  const views = await import("../saved-views/crm-saved-views.service");
  const settings = await import("../settings/crm-settings.service");
  const { parseOpportunityFilterParams } = await import("./opportunity.schema");

  const run = `o${Date.now().toString(36)}`;
  const phone = `9${String(Date.now()).slice(-9)}`;
  let manager: Actor;
  let rep: Actor;
  let otherRep: Actor;
  let noSales: Actor;
  let stages: { id: string; key: string; name: string; probability: number | null; pipelineId: string }[];
  const stage = (key: string) => stages.find((s) => s.key === key)!;
  const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });
  const sort = { sortBy: "createdAt" as const, sortOrder: "desc" as const };
  const page = { skip: 0, take: 50 };
  const list = (actor: Actor, qs: string) => opps.listOpportunities(actor, parseOpportunityFilterParams(new URLSearchParams(qs)), sort, page);
  const name = (n: string) => `${n} ${run}`;
  const raw = (id: string) => prisma.crmOpportunity.findUniqueOrThrow({ where: { id } });
  const version = async (id: string) => (await raw(id)).version;
  const eventsOf = (id: string) => prisma.crmEvent.findMany({ where: { entityId: id }, orderBy: { occurredAt: "asc" } });
  const eventTypes = async (id: string) => (await eventsOf(id)).map((e) => e.eventType);
  let seq = 0;
  const mkCustomer = (label: string) => prisma.customer.create({ data: { companyId: manager.companyId, code: `OT-${run}-${++seq}`, name: `${label} ${run}` } });
  const mkOrder = (customerId: string, amount: string) =>
    prisma.salesOrder.create({ data: { companyId: manager.companyId, orderNumber: `SO-${run}-${++seq}`, customerId, orderDate: new Date("2026-10-01"), currencyCode: "INR", baseCurrencyCode: "INR", totalAmount: amount, baseTotalAmount: amount, requestedByUserId: manager.userId } });
  const mkEnquiry = (customerId: string) => prisma.buyerEnquiry.create({ data: { companyId: manager.companyId, enquiryNumber: `BE-${run}-${++seq}`, customerId, enquiryDate: new Date("2026-09-20"), requestedByUserId: manager.userId } });

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@crm-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [m, r, o, x] = await Promise.all([mk("manager"), mk("rep"), mk("otherrep"), mk("nosales")]);
    manager = { companyId: company.id, userId: m.id, branchId: null };
    rep = { companyId: company.id, userId: r.id, branchId: null };
    otherRep = { companyId: company.id, userId: o.id, branchId: null };
    noSales = { companyId: company.id, userId: x.id, branchId: null };
    viewAllUsers.add(m.id);
    noSalesUsers.add(x.id);
    const [sales] = await pipelines.listPipelines(company.id);
    stages = sales.stages.map((s) => ({ ...s, pipelineId: sales.id }));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates an opportunity in the default pipeline's first stage with defaults, keys, tags, audit and events", async () => {
    const co = await companies.createCompany(rep, { name: name("Acme Garments") });
    const ct = await contacts.createContact(rep, { firstName: "Asha", lastName: run, crmCompanyId: co.id });
    const o = await opps.createOpportunity(rep, { name: name("  AW26   Knitwear "), crmCompanyId: co.id, crmContactId: ct.id, amount: "500000", expectedCloseDate: "2026-12-31", tagNames: [`hot-${run}`], description: "Requirement: 20k pcs" });
    const r = await raw(o.id);
    expect(r).toMatchObject({ status: "OPEN", ownerUserId: rep.userId, stageId: stage("new").id, pipelineId: stage("new").pipelineId, probability: stage("new").probability, currencyCode: "INR", nameKey: `aw26 knitwear ${run}`.toLowerCase(), version: 1 });
    expect(r.opportunityNumber).toMatch(/^OPP-/);
    expect(r.searchText).toContain(r.opportunityNumber.toLowerCase());
    const detail = await opps.getOpportunity(rep, o.id);
    expect(detail.source?.key).toBe("manual");
    expect(detail.tags.map((t) => t.name)).toEqual([`hot-${run}`]);
    expect(detail.crmCompany?.name).toBe(co.name);
    expect(detail.crmContact?.fullName).toBe(`Asha ${run}`);
    expect(await eventTypes(o.id)).toEqual(["opportunity.created", "opportunity.tag_added"]);
    expect(await eventTypes(co.id)).toContain("company.opportunity_linked");
    expect(await eventTypes(ct.id)).toContain("contact.opportunity_linked");
    expect(await prisma.auditLog.count({ where: { recordId: o.id, tableName: "crm_opportunities", action: "CREATE" } })).toBe(1);
    expect(r.lastActivityAt).not.toBeNull();
  });

  it("supports company only, contact only and both; many opportunities per company and contact", async () => {
    const co = await companies.createCompany(rep, { name: name("Multi Deals") });
    const c1 = await contacts.createContact(rep, { firstName: "Ravi", lastName: run, crmCompanyId: co.id });
    const c2 = await contacts.createContact(rep, { firstName: "Meera", lastName: run, crmCompanyId: co.id });
    const a = await opps.createOpportunity(rep, { name: name("Website"), crmCompanyId: co.id });
    const b = await opps.createOpportunity(rep, { name: name("CRM rollout"), crmCompanyId: co.id, crmContactId: c1.id });
    const c = await opps.createOpportunity(rep, { name: name("Annual support"), crmCompanyId: co.id, crmContactId: c1.id });
    const d = await opps.createOpportunity(rep, { name: name("Private label"), crmContactId: c2.id });
    expect((await list(rep, `crmCompanyIds=${co.id}`)).data.map((x) => x.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect((await list(rep, `crmContactIds=${c1.id}`)).data.map((x) => x.id).sort()).toEqual([b.id, c.id].sort());
    expect((await raw(d.id)).crmCompanyId).toBeNull();
    const companyOpps = await relations.listCompanyOpportunities(rep, co.id, { page: 1, pageSize: 10, includeArchived: false });
    expect(companyOpps.meta.totalCount).toBe(3);
    expect(companyOpps.data[0].stage?.name).toBe("New");
    expect((await companies.getCompany(rep, co.id)).counts.openOpportunities).toBe(3);
    await expectCode(opps.createOpportunity(rep, { name: name("Hidden"), crmCompanyId: (await companies.createCompany(otherRep, { name: name("Not mine") })).id }), "VALIDATION_ERROR");
  });

  it("warns (never blocks) on an open opportunity with the same name, company and contact", async () => {
    const co = await companies.createCompany(rep, { name: name("Dup Co") });
    const ct = await contacts.createContact(rep, { firstName: "Dup", lastName: run, crmCompanyId: co.id });
    const first = await opps.createOpportunity(rep, { name: name("Spring range"), crmCompanyId: co.id, crmContactId: ct.id });
    await expect(opps.createOpportunity(rep, { name: name("SPRING   range"), crmCompanyId: co.id, crmContactId: ct.id })).rejects.toMatchObject({
      code: "CRM_POSSIBLE_DUPLICATE",
      details: { entityType: "OPPORTUNITY", blocking: false },
    });
    const live = await opps.checkOpportunityDuplicates(rep, { name: name("spring range"), crmCompanyId: co.id, crmContactId: ct.id });
    expect(live.matches.map((m) => m.id)).toEqual([first.id]);
    // Different contact, or a closed one: not a duplicate. Confirmation always allows it.
    await opps.createOpportunity(rep, { name: name("Spring range"), crmCompanyId: co.id });
    const second = await opps.createOpportunity(rep, { name: name("Spring range"), crmCompanyId: co.id, crmContactId: ct.id, confirmDuplicate: true });
    expect(second.id).not.toBe(first.id);
    await opps.changeOpportunityStatus(rep, first.id, { status: "LOST" });
    await opps.changeOpportunityStatus(rep, second.id, { status: "ABANDONED" });
    await opps.createOpportunity(rep, { name: name("Spring range"), crmCompanyId: co.id, crmContactId: ct.id });
  });

  it("tracks stage changes with old/new stage and probability in the timeline and audit log", async () => {
    const o = await opps.createOpportunity(rep, { name: name("Stage walk") });
    await opps.changeOpportunityStage(rep, o.id, { stageId: stage("qualified").id, version: 1 });
    let r = await raw(o.id);
    expect(r).toMatchObject({ stageId: stage("qualified").id, probability: stage("qualified").probability });
    const ev = (await eventsOf(o.id)).find((e) => e.eventType === "opportunity.stage_changed")!;
    expect(ev.payload).toMatchObject({ fromStage: "New", toStage: "Qualified", fromProbability: stage("new").probability, toProbability: stage("qualified").probability });
    expect(ev.actorUserId).toBe(rep.userId);
    const audit = await prisma.auditLog.findFirst({ where: { recordId: o.id, tableName: "crm_opportunities", action: "UPDATE" }, orderBy: { performedAt: "desc" } });
    expect(audit?.oldValues).toMatchObject({ stageId: stage("new").id });
    expect(audit?.newValues).toMatchObject({ stageId: stage("qualified").id });

    // A hand-set probability survives the next stage change; an explicit one replaces it.
    await opps.changeOpportunityStage(rep, o.id, { stageId: stage("qualified").id, probability: 40 });
    await opps.changeOpportunityStage(rep, o.id, { stageId: stage("proposal").id });
    expect((await raw(o.id)).probability).toBe(40);
    await opps.changeOpportunityStage(rep, o.id, { stageId: stage("negotiation").id, probability: 0 });
    expect((await raw(o.id)).probability).toBe(0);
    await opps.updateOpportunity(rep, o.id, { version: await version(o.id), probability: 100 });
    expect((await raw(o.id)).probability).toBe(100);
    await expect(opps.changeOpportunityStage(rep, o.id, { stageId: stage("closing").id, probability: 101 })).rejects.toBeTruthy();
    await expect(opps.updateOpportunity(rep, o.id, { version: await version(o.id), probability: -1 })).rejects.toBeTruthy();
    await expectCode(opps.changeOpportunityStage(rep, o.id, { stageId: "00000000-0000-4000-8000-000000000000" }), "VALIDATION_ERROR");
    r = await raw(o.id);
    expect(r.probability).toBe(100);
    expect((await eventTypes(o.id)).filter((t) => t === "opportunity.stage_changed")).toHaveLength(3);
    expect(await eventTypes(o.id)).toContain("opportunity.probability_changed");
  });

  it("closes as Won / Lost / Abandoned with closed_at and reason, blocks edits until reopened, and audits every change", async () => {
    for (const [status, event] of [
      ["WON", "opportunity.won"],
      ["LOST", "opportunity.lost"],
      ["ABANDONED", "opportunity.abandoned"],
    ] as const) {
      const o = await opps.createOpportunity(rep, { name: name(`Close ${status}`) });
      await opps.changeOpportunityStatus(rep, o.id, { status, reason: "Price", version: 1 });
      const r = await raw(o.id);
      expect(r).toMatchObject({ status, closeReason: "Price", closedByUserId: rep.userId });
      expect(r.closedAt).not.toBeNull();
      const ev = (await eventsOf(o.id)).find((e) => e.eventType === event)!;
      expect(ev.payload).toMatchObject({ fromStatus: "OPEN", toStatus: status, reason: "Price" });
      await expectCode(opps.updateOpportunity(rep, o.id, { version: r.version, name: "x" }), "INVALID_STATE_TRANSITION");
      await expectCode(opps.changeOpportunityStage(rep, o.id, { stageId: stage("closing").id }), "INVALID_STATE_TRANSITION");
      await expectCode(opps.changeOpportunityStatus(rep, o.id, { status: status === "WON" ? "LOST" : "WON" }), "INVALID_STATE_TRANSITION");
      // Closed deals can still be reassigned and tagged.
      await opps.assignOpportunity(rep, o.id, { ownerUserId: rep.userId });
      await opps.changeOpportunityTags(rep, o.id, { addTagIds: [], addTagNames: [`closed-${run}`], removeTagIds: [] });
      await opps.changeOpportunityStatus(rep, o.id, { status: "OPEN" });
      const reopened = await raw(o.id);
      expect(reopened).toMatchObject({ status: "OPEN", closedAt: null, closeReason: null });
      expect(await eventTypes(o.id)).toContain("opportunity.reopened");
      expect(await prisma.auditLog.count({ where: { recordId: o.id, tableName: "crm_opportunities", action: "UPDATE" } })).toBeGreaterThanOrEqual(2);
    }
  });

  it("records value, close date, company/contact and owner changes as their own timeline events", async () => {
    const co1 = await companies.createCompany(rep, { name: name("Old Co") });
    const co2 = await companies.createCompany(rep, { name: name("New Co") });
    const ct = await contacts.createContact(rep, { firstName: "Link", lastName: run });
    const o = await opps.createOpportunity(rep, { name: name("Changes"), crmCompanyId: co1.id, amount: 1000, currencyCode: "USD" });
    await opps.updateOpportunity(rep, o.id, { version: 1, amount: 2500, expectedCloseDate: "2026-11-30", crmCompanyId: co2.id, crmContactId: ct.id, description: "Updated scope" });
    await opps.assignOpportunity(rep, o.id, { ownerUserId: manager.userId });
    const types = await eventTypes(o.id);
    for (const t of ["opportunity.value_changed", "opportunity.close_date_changed", "opportunity.company_linked", "opportunity.contact_linked", "opportunity.updated", "opportunity.owner_changed"]) expect(types).toContain(t);
    const value = (await eventsOf(o.id)).find((e) => e.eventType === "opportunity.value_changed")!;
    expect(value.payload).toMatchObject({ from: { amount: 1000, currencyCode: "USD" }, to: { amount: 2500, currencyCode: "USD" } });
    await expectCode(opps.updateOpportunity(rep, o.id, { version: 1, name: "stale" }), "NOT_FOUND"); // reassigned away from the rep
    await expectCode(opps.updateOpportunity(manager, o.id, { version: 1, name: "stale" }), "RECORD_VERSION_CONFLICT");
  });

  it("searches, filters, sorts and pages server-side with OWN visibility", async () => {
    const co = await companies.createCompany(rep, { name: name("Searchco Textiles"), phone: `+91 ${phone}` });
    const ct = await contacts.createContact(rep, { firstName: "Zed", lastName: run, email: `zed.${run}@example.test`, crmCompanyId: co.id });
    const a = await opps.createOpportunity(rep, { name: name("Alpha"), crmCompanyId: co.id, crmContactId: ct.id, amount: 1000, expectedCloseDate: "2026-10-20" });
    const b = await opps.createOpportunity(rep, { name: name("Beta"), crmCompanyId: co.id, amount: 90000, probability: 80 });
    const hidden = await opps.createOpportunity(otherRep, { name: name("Gamma") });
    expect((await list(rep, `search=${encodeURIComponent("searchco")}`)).data.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect((await list(rep, `search=${encodeURIComponent(`zed.${run}@example`)}`)).data.map((x) => x.id)).toEqual([a.id]);
    expect((await list(rep, `search=${phone.slice(0, 5)} ${phone.slice(5)}`)).data.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect((await list(rep, `search=${(await raw(a.id)).opportunityNumber}`)).data.map((x) => x.id)).toEqual([a.id]);
    expect((await list(rep, `search=${run}`)).data.map((x) => x.id)).not.toContain(hidden.id);
    expect((await list(manager, `search=${encodeURIComponent(name("gamma"))}`)).data.map((x) => x.id)).toEqual([hidden.id]);
    await expectCode(opps.getOpportunity(rep, hidden.id), "NOT_FOUND");
    expect((await list(rep, `crmCompanyIds=${co.id}&amountMin=50000`)).data.map((x) => x.id)).toEqual([b.id]);
    expect((await list(rep, `crmCompanyIds=${co.id}&probabilityMin=50`)).data.map((x) => x.id)).toEqual([b.id]);
    expect((await list(rep, `crmCompanyIds=${co.id}&expectedCloseDateFrom=2026-10-01&expectedCloseDateTo=2026-10-31`)).data.map((x) => x.id)).toEqual([a.id]);
    expect((await list(rep, `crmCompanyIds=${co.id}&stageIds=${stage("new").id}&statuses=OPEN&ownerUserIds=${rep.userId}`)).data).toHaveLength(2);
    const sorted = await opps.listOpportunities(rep, parseOpportunityFilterParams(new URLSearchParams(`crmCompanyIds=${co.id}`)), { sortBy: "amount", sortOrder: "desc" }, { skip: 0, take: 1 });
    expect(sorted.data.map((x) => x.id)).toEqual([b.id]);
    expect(sorted.totalCount).toBe(2);
  });

  it("links several ERP documents (live data, never copied), validates them and unlinks", async () => {
    const customer = await mkCustomer("Erp Buyer");
    const otherCustomer = await mkCustomer("Someone Else");
    const co = await companies.createCompany(manager, { name: name("Erp Linked"), customerId: customer.id });
    const o = await opps.createOpportunity(manager, { name: name("With quotes"), crmCompanyId: co.id, amount: 10000 });
    const [so1, so2, enquiry, foreign] = await Promise.all([mkOrder(customer.id, "12000.00"), mkOrder(customer.id, "11500.00"), mkEnquiry(customer.id), mkOrder(otherCustomer.id, "999.00")]);

    const search = await erp.searchLinkableErpDocuments(manager, o.id, { docType: "SALES_ORDER" });
    expect(search.customerLinked).toBe(true);
    expect(search.rows.map((r) => r.id).sort()).toEqual([so1.id, so2.id].sort());

    await erp.linkErpDocument(manager, o.id, { docType: "SALES_ORDER", docId: so1.id });
    await erp.linkErpDocument(manager, o.id, { docType: "SALES_ORDER", docId: so2.id });
    await erp.linkErpDocument(manager, o.id, { docType: "BUYER_ENQUIRY", docId: enquiry.id });
    await expectCode(erp.linkErpDocument(manager, o.id, { docType: "SALES_ORDER", docId: so1.id }), "INVALID_STATE_TRANSITION");
    await expectCode(erp.linkErpDocument(manager, o.id, { docType: "SALES_ORDER", docId: foreign.id }), "VALIDATION_ERROR");
    await expectCode(erp.linkErpDocument(manager, o.id, { docType: "SALES_ORDER", docId: "00000000-0000-4000-8000-000000000000" }), "NOT_FOUND");
    await expect(erp.linkErpDocument(manager, o.id, { docType: "QUOTATION", docId: so1.id })).rejects.toBeTruthy();

    const listed = await erp.listOpportunityErpDocuments(manager, o.id);
    const orders = listed.sections.find((s) => s.type === "SALES_ORDER")!;
    expect(orders.rows.map((r) => r.doc?.amount).sort()).toEqual(["11500", "12000"]);
    expect(listed.notAvailable.map((n) => n.key)).toEqual(["QUOTATION"]);
    // The estimated value is never overwritten by ERP amounts; the ERP rows are untouched.
    expect(Number((await raw(o.id)).amount)).toBe(10000);
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: so1.id } })).updatedAt.getTime()).toBe(so1.updatedAt.getTime());
    // Search by ERP document number.
    expect((await list(manager, `search=${so2.orderNumber.toLowerCase()}`)).data.map((x) => x.id)).toEqual([o.id]);
    expect(await eventTypes(o.id)).toContain("opportunity.erp_document_linked");

    // Without sales-order access: section hidden, linking refused.
    viewAllUsers.add(noSales.userId);
    const blind = await erp.listOpportunityErpDocuments(noSales, o.id);
    const blindOrders = blind.sections.find((s) => s.type === "SALES_ORDER")!;
    expect(blindOrders.allowed).toBe(false);
    expect(blindOrders.rows.every((r) => r.doc === null)).toBe(true);
    await expectCode(erp.linkErpDocument(noSales, o.id, { docType: "SALES_ORDER", docId: so1.id }), "PERMISSION_DENIED");
    await expectCode(erp.searchLinkableErpDocuments(noSales, o.id, { docType: "SALES_ORDER" }), "PERMISSION_DENIED");
    viewAllUsers.delete(noSales.userId);
    await expectCode(erp.listOpportunityErpDocuments(otherRep, o.id), "NOT_FOUND");

    const link = orders.rows.find((r) => r.docId === so2.id)!;
    await erp.unlinkErpDocument(manager, o.id, link.linkId);
    expect((await erp.listOpportunityErpDocuments(manager, o.id)).sections.find((s) => s.type === "SALES_ORDER")!.rows).toHaveLength(1);
    expect(await prisma.salesOrder.count({ where: { id: so2.id } })).toBe(1);
    expect((await list(manager, `search=${so2.orderNumber.toLowerCase()}`)).data).toHaveLength(0);
    expect(await eventTypes(o.id)).toContain("opportunity.erp_document_unlinked");
  });

  it("creates from a lead (keeps lead and source), and lead conversion lands in the default stage", async () => {
    const source = (await settings.listLeadSources(rep.companyId)).find((s) => s.key !== "manual" && s.isActive)!;
    const lead = await leads.createLead(rep, { firstName: "Lia", lastName: run, email: `lia.${run}@example.test`, sourceId: source.id });
    const prefill = await opps.getOpportunityPrefill(rep, { leadId: lead.id });
    expect(prefill.lead?.id).toBe(lead.id);
    const o = await opps.createOpportunity(rep, { name: name("From lead"), leadId: lead.id });
    expect(await raw(o.id)).toMatchObject({ leadId: lead.id, sourceId: source.id });
    expect(await eventTypes(lead.id)).toContain("lead.opportunity_created");
    // A second opportunity from the same lead is allowed (several deals).
    await opps.createOpportunity(rep, { name: name("From lead, second deal"), leadId: lead.id });
    await expectCode(opps.createOpportunity(otherRep, { name: name("Not my lead"), leadId: lead.id }), "VALIDATION_ERROR");

    const lead2 = await leads.createLead(rep, { firstName: "Conv", lastName: run, email: `conv.${run}@example.test` });
    const res = await leads.convertLead(rep, lead2.id, { company: { mode: "create", name: name("Converted Co") }, contact: { mode: "create" }, opportunity: { create: true, name: name("Converted deal"), amount: 5000 } });
    const converted = await raw(res.opportunityId!);
    expect(converted).toMatchObject({ stageId: stage("new").id, probability: stage("new").probability, leadId: lead2.id });
    expect(converted.searchText).toContain("converted deal");
  });

  it("archives and restores without losing history; notes, documents and timeline work", async () => {
    const o = await opps.createOpportunity(rep, { name: name("Archive me") });
    await notes.createNote(rep, "OPPORTUNITY", o.id, { body: "Buyer wants samples by Friday" });
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
    const att = await documents.uploadCrmDocument(rep, "OPPORTUNITY", o.id, { buffer: pdf, fileName: "brief.pdf", mimeType: "application/pdf" }, "Customer brief");
    expect(att).toMatchObject({ relatedModule: "CRM_OPPORTUNITY", relatedRecordId: o.id });
    await expectCode(documents.downloadCrmDocument(otherRep, att.id), "NOT_FOUND");
    await opps.archiveOpportunity(rep, o.id);
    expect((await list(rep, `search=${encodeURIComponent(name("archive me"))}`)).data).toHaveLength(0);
    expect((await list(rep, `search=${encodeURIComponent(name("archive me"))}&archived=only`)).data.map((x) => x.id)).toEqual([o.id]);
    await expectCode(opps.updateOpportunity(rep, o.id, { version: await version(o.id), name: "x" }), "INVALID_STATE_TRANSITION");
    await expectCode(documents.uploadCrmDocument(rep, "OPPORTUNITY", o.id, { buffer: pdf, fileName: "x.pdf", mimeType: "application/pdf" }), "INVALID_STATE_TRANSITION");
    expect((await documents.listCrmDocuments(rep, "OPPORTUNITY", o.id)).map((d) => d.id)).toEqual([att.id]);
    await opps.restoreOpportunity(rep, o.id);
    const timeline = await events.listCrmEvents(rep.companyId, { entityType: "OPPORTUNITY", entityId: o.id } as never, { page: 1, pageSize: 50, skip: 0, take: 50, sortBy: "occurredAt", sortOrder: "asc" } as never);
    expect(timeline.data.map((e) => e.eventType)).toEqual(expect.arrayContaining(["opportunity.created", "opportunity.note_added", "opportunity.document_added", "opportunity.archived", "opportunity.restored"]));
    await expectCode(access.assertCrmEntityAccess(otherRep, "OPPORTUNITY", o.id), "NOT_FOUND");
  });

  it("validates custom fields and supports tags and saved views", async () => {
    await prisma.crmCustomFieldDefinition.create({ data: { companyId: manager.companyId, entityType: "OPPORTUNITY", key: `qty_${run}`, label: "Estimated quantity", fieldType: "NUMBER" } });
    const o = await opps.createOpportunity(rep, { name: name("Custom"), customFields: { [`qty_${run}`]: 20000 }, tagNames: [`cf-${run}`] });
    expect(((await raw(o.id)).customFields as Record<string, unknown>)[`qty_${run}`]).toBe(20000);
    await expectCode(opps.createOpportunity(rep, { name: name("Custom bad"), customFields: { [`qty_${run}`]: "lots" } }), "VALIDATION_ERROR");
    const tag = await prisma.crmTag.findFirstOrThrow({ where: { companyId: rep.companyId, name: `cf-${run}` } });
    expect((await list(rep, `tagIds=${tag.id}`)).data.map((x) => x.id)).toEqual([o.id]);
    const view = await views.createSavedView(rep, "OPPORTUNITY", { name: `Closing ${run}`, filters: { closeDue: "next_30_days", statuses: ["OPEN"], archived: "exclude" }, sort: { sortBy: "expectedCloseDate", sortOrder: "asc" } });
    expect(view.entityType).toBe("OPPORTUNITY");
    await expectCode(views.createSavedView(rep, "OPPORTUNITY", { name: "bad", filters: {}, sort: { sortBy: "score", sortOrder: "desc" } }), "VALIDATION_ERROR");
  });

  it("runs bulk actions with skipped reasons", async () => {
    const x = await opps.createOpportunity(rep, { name: name("Bulk X") });
    const y = await opps.createOpportunity(rep, { name: name("Bulk Y") });
    const hidden = await opps.createOpportunity(otherRep, { name: name("Bulk hidden") });
    await opps.changeOpportunityStatus(rep, y.id, { status: "WON" });
    const staged = await opps.bulkOpportunityAction(rep, { action: "stage", ids: [x.id, y.id, hidden.id], stageId: stage("proposal").id });
    expect(staged).toMatchObject({ requested: 3, updated: 1 });
    expect(staged.skipped.map((s) => s.reason).sort()).toEqual(["Closed — reopen it first", "Not found or not visible to you"]);
    expect((await raw(x.id)).probability).toBe(stage("proposal").probability);
    const lost = await opps.bulkOpportunityAction(rep, { action: "status", ids: [x.id, y.id], status: "LOST", reason: "Budget cancelled" });
    expect(lost).toMatchObject({ updated: 1, skipped: [{ id: y.id, reason: "Reopen it first" }] });
    expect(await raw(x.id)).toMatchObject({ status: "LOST", closeReason: "Budget cancelled" });
    expect((await opps.bulkOpportunityAction(rep, { action: "addTags", ids: [x.id, y.id], tagNames: [`bulk-${run}`] })).updated).toBe(2);
    expect((await opps.bulkOpportunityAction(rep, { action: "assign", ids: [x.id], ownerUserId: manager.userId })).updated).toBe(1);
    expect((await opps.bulkOpportunityAction(manager, { action: "archive", ids: [x.id] })).updated).toBe(1);
  });

  it("never changes ERP or other CRM masters when opportunities change", async () => {
    const customer = await mkCustomer("Untouched");
    const before = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    const co = await companies.createCompany(manager, { name: name("Untouched Co"), customerId: customer.id });
    const coBefore = await prisma.crmCompany.findUniqueOrThrow({ where: { id: co.id } });
    const o = await opps.createOpportunity(manager, { name: name("Side effects"), crmCompanyId: co.id, amount: 1 });
    await opps.changeOpportunityStatus(manager, o.id, { status: "WON" });
    await opps.archiveOpportunity(manager, o.id);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).toEqual(before);
    const coAfter = await prisma.crmCompany.findUniqueOrThrow({ where: { id: co.id } });
    expect({ ...coAfter, lastActivityAt: null, updatedAt: null }).toEqual({ ...coBefore, lastActivityAt: null, updatedAt: null });
  });
});
