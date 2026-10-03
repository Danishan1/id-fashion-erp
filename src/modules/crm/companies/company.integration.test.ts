/**
 * CRM Companies / Accounts (Phase 05) against a real, migrated + seeded
 * Postgres database.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database (it
 * writes companies, contacts, leads, users, notes, attachments and test
 * ERP customers):
 *   CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/crm/companies/company.integration.test.ts
 *
 * Only permissions are mocked: `crm.view_all` is granted to the "manager"
 * test user and denied to the "rep" users; ERP customer access is denied to
 * users in `noErpUsers`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const viewAllUsers = new Set<string>();
const noErpUsers = new Set<string>();
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, module: string, action: string) => {
      if (action === "view_all") return viewAllUsers.has(userId);
      if (["masters_core", "sales_orders", "buyer_enquiries", "invoices", "payments"].includes(module)) return !noErpUsers.has(userId);
      return true;
    }),
    assert: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("CRM companies (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const companies = await import("./crm-companies.service");
  const relations = await import("./company-relations.service");
  const merge = await import("./company-merge.service");
  const { companyMatchKey } = await import("./company-keys");
  const contacts = await import("../contacts/crm-contacts.service");
  const leads = await import("../leads/lead.service");
  const notes = await import("../notes/crm-notes.service");
  const documents = await import("../documents/crm-documents.service");
  const settings = await import("../settings/crm-settings.service");
  const events = await import("../core/crm-events.service");
  const access = await import("../crm-entity-access");
  const views = await import("../saved-views/crm-saved-views.service");
  const { parseCompanyFilterParams } = await import("./company.schema");

  const run = `k${Date.now().toString(36)}`;
  let manager: Actor;
  let rep: Actor;
  let otherRep: Actor;
  let noErp: Actor;
  const digits = String(Date.now()).slice(-6);
  const phone = (n: number) => `9${n}${n}${n}${digits}`.slice(0, 10);
  const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });
  const sort = { sortBy: "createdAt" as const, sortOrder: "desc" as const };
  const page = { skip: 0, take: 50 };
  const list = (actor: Actor, qs: string) => companies.listCompanies(actor, parseCompanyFilterParams(new URLSearchParams(qs)), sort, page);
  // Run id first, so legal suffixes ("Pvt Ltd") stay at the end of the name.
  const name = (n: string) => `${run} ${n}`;
  const version = async (id: string) => (await prisma.crmCompany.findUniqueOrThrow({ where: { id } })).version;
  const eventTypes = async (id: string) => (await prisma.crmEvent.findMany({ where: { entityId: id }, orderBy: { occurredAt: "asc" } })).map((e) => e.eventType);
  const setRules = (over: Record<string, string>) =>
    settings.updateCompanyDuplicateRules(manager, {
      rules: ["NAME", "LEGAL_NAME", "WEBSITE", "EMAIL", "PHONE"].map((rule) => ({ rule, action: over[rule] ?? "WARN" })),
    });
  let customerSeq = 0;
  const mkCustomer = (label: string) =>
    prisma.customer.create({ data: { companyId: manager.companyId, code: `IT-${run}-${++customerSeq}`, name: `${label} ${run}`, city: "Tiruppur", creditLimit: "125000.00", email: `${label.toLowerCase()}@erp.test` } });
  const customerSnapshot = (id: string) => prisma.customer.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@crm-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [m, r, o, x] = await Promise.all([mk("manager"), mk("rep"), mk("otherrep"), mk("noerp")]);
    manager = { companyId: company.id, userId: m.id, branchId: null };
    rep = { companyId: company.id, userId: r.id, branchId: null };
    otherRep = { companyId: company.id, userId: o.id, branchId: null };
    noErp = { companyId: company.id, userId: x.id, branchId: null };
    viewAllUsers.add(m.id);
    noErpUsers.add(x.id);
    await setRules({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a company with default status, manual source, owner, derived keys, address, tags, audit and events", async () => {
    const c = await companies.createCompany(rep, {
      name: name("The Aurora Apparel Pvt. Ltd."),
      legalName: name("Aurora Apparel Private Limited"),
      website: `aurora-${run}.example`,
      email: `info@aurora-${run}.example`,
      phone: phone(1),
      industry: "Apparel brand",
      city: "Chennai",
      country: "India",
      addresses: [{ addressType: "OFFICE", line1: "1 Mount Road", city: "Chennai", country: "India" }],
      tagNames: [`key-${run}`],
    });
    expect(c).toMatchObject({ ownerUserId: rep.userId, version: 1, website: `https://aurora-${run}.example`, websiteKey: `aurora-${run}.example` });
    expect(c.nameMatchKey).toBe(companyMatchKey(name("The Aurora Apparel Pvt. Ltd.")));
    const detail = await companies.getCompany(rep, c.id);
    expect(detail.status?.key).toBe("prospect");
    expect(detail.source?.key).toBe("manual");
    expect(detail.addresses).toHaveLength(1);
    expect(detail.addresses[0].isPrimary).toBe(true);
    expect(detail.tags.map((t) => t.name)).toEqual([`key-${run}`]);
    expect(detail.customer).toBeNull();
    expect(await eventTypes(c.id)).toEqual(["company.created", "company.tag_added"]);
    expect(await prisma.auditLog.count({ where: { recordId: c.id, tableName: "crm_companies", action: "CREATE" } })).toBe(1);
    expect(detail.lastActivityAt).not.toBeNull();
  });

  it("searches, filters, sorts and pages server-side with OWN visibility", async () => {
    const a = await companies.createCompany(rep, { name: name("Searchable Knits"), city: "Tiruppur", industry: "Wholesale", mobile: `+91 ${phone(2)}` });
    const b = await companies.createCompany(otherRep, { name: name("Hidden Weaves"), city: "Tiruppur" });
    expect((await list(rep, `search=${encodeURIComponent("searchable knits")}`)).data.map((r) => r.id)).toEqual([a.id]);
    expect((await list(rep, `search=${phone(2).slice(0, 5)} ${phone(2).slice(5)}`)).data.map((r) => r.id)).toEqual([a.id]);
    const repTiruppur = (await list(rep, "city=tiruppur")).data.map((r) => r.id);
    expect(repTiruppur).toContain(a.id);
    expect(repTiruppur).not.toContain(b.id);
    expect((await list(manager, "city=tiruppur")).data.map((r) => r.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect((await list(rep, "industry=wholesale&erpCustomer=not_linked")).data.map((r) => r.id)).toContain(a.id);
    await expectCode(companies.getCompany(rep, b.id), "NOT_FOUND");
    const paged = await companies.listCompanies(manager, parseCompanyFilterParams(new URLSearchParams(`search=${run}`)), { sortBy: "name", sortOrder: "asc" }, { skip: 0, take: 2 });
    expect(paged.data).toHaveLength(2);
    expect(paged.totalCount).toBeGreaterThan(2);
    const names = paged.data.map((r) => r.name);
    expect([...names].sort((x, y) => x.localeCompare(y))).toEqual(names);
  });

  it("applies company duplicate rules: WARN needs confirmation, suffixes and domains match, BLOCK refuses, FLAG saves and marks", async () => {
    await companies.createCompany(rep, { name: name("Dup Fabrics"), website: `https://www.dupfab-${run}.example/home` });
    await expectCode(companies.createCompany(rep, { name: name("Dup Fabrics Pvt Ltd") }), "CRM_POSSIBLE_DUPLICATE");
    await expectCode(companies.createCompany(rep, { name: name("Different"), website: `dupfab-${run}.example` }), "CRM_POSSIBLE_DUPLICATE");
    const live = await companies.checkCompanyDuplicates(rep, { name: name("dup fabrics llp") });
    expect(live.matches[0].rules).toContain("NAME");
    const confirmed = await companies.createCompany(rep, { name: name("Dup Fabrics LLP"), confirmDuplicate: true });
    expect(confirmed.duplicateFlaggedAt).toBeNull();

    await setRules({ WEBSITE: "BLOCK" });
    await expect(companies.createCompany(rep, { name: name("Third"), website: `dupfab-${run}.example`, confirmDuplicate: true })).rejects.toMatchObject({
      code: "CRM_DUPLICATE_RECORD",
      details: { entityType: "COMPANY", blocking: true },
    });
    await setRules({ NAME: "FLAG" });
    const flagged = await companies.createCompany(rep, { name: name("Dup Fabrics Limited") });
    expect(flagged.duplicateFlaggedAt).not.toBeNull();
    expect(flagged.flaggedDuplicateIds.length).toBeGreaterThanOrEqual(2);
    expect((await list(rep, "duplicateFlagged=true")).data.map((r) => r.id)).toContain(flagged.id);
    expect((await companies.getCompany(rep, flagged.id)).flaggedDuplicates.length).toBeGreaterThanOrEqual(2);
    const cleared = await companies.dismissCompanyDuplicateFlag(rep, flagged.id);
    expect(cleared.flaggedDuplicateIds).toEqual([]);
    await setRules({});
  });

  it("links an existing ERP customer under control and never changes the customer master", async () => {
    const customer = await mkCustomer("Linkable");
    const before = await customerSnapshot(customer.id);
    const c = await companies.createCompany(rep, { name: name("Link Target") });

    await expectCode(companies.linkErpCustomer(noErp, c.id, { customerId: customer.id }), "NOT_FOUND"); // can't see rep's company
    const own = await companies.createCompany(noErp, { name: name("No ERP access") });
    await expectCode(companies.linkErpCustomer(noErp, own.id, { customerId: customer.id }), "PERMISSION_DENIED");
    await expectCode(companies.linkErpCustomer(rep, c.id, { customerId: "00000000-0000-4000-8000-000000000000" }), "NOT_FOUND");

    await companies.linkErpCustomer(rep, c.id, { customerId: customer.id });
    const detail = await companies.getCompany(rep, c.id);
    expect(detail.customer).toMatchObject({ id: customer.id, code: customer.code });
    expect(detail.searchText).toContain(customer.code.toLowerCase());
    expect(await eventTypes(c.id)).toContain("company.erp_customer_linked");
    expect(await prisma.auditLog.count({ where: { recordId: c.id, tableName: "crm_companies", action: "UPDATE" } })).toBeGreaterThan(0);

    // One ERP customer ↔ one CRM company
    const other = await companies.createCompany(rep, { name: name("Second Link") });
    await expect(companies.linkErpCustomer(rep, other.id, { customerId: customer.id })).rejects.toMatchObject({ code: "CRM_DUPLICATE_RECORD", details: { blocking: true } });
    await expect(companies.createCompany(rep, { name: name("Third Link"), customerId: customer.id, confirmDuplicate: true })).rejects.toMatchObject({ code: "CRM_DUPLICATE_RECORD" });
    const picker = await companies.searchCustomersForLinking(rep, customer.code, 5);
    expect(picker.find((p) => p.id === customer.id)?.crmCompanyId).toBe(c.id);

    // Deleted customers can't be linked
    const deleted = await prisma.customer.create({ data: { companyId: manager.companyId, code: `IT-${run}-del`, name: `Deleted ${run}`, deletedAt: new Date() } });
    await expectCode(companies.linkErpCustomer(rep, other.id, { customerId: deleted.id }), "NOT_FOUND");

    // ERP references are read through the ERP, never copied
    const refs = await relations.getCompanyErpReferences(rep, c.id);
    expect(refs.linked).toBe(true);
    if (refs.linked) {
      expect(refs.customer?.id).toBe(customer.id);
      expect(refs.sections.map((s) => s.key)).toEqual(["buyerEnquiries", "salesOrders", "salesInvoices", "receipts"]);
      expect(refs.notAvailable.map((n) => n.key)).toEqual(expect.arrayContaining(["quotations", "tickets"]));
    }
    const noErpRefs = await relations.getCompanyErpReferences(noErp, own.id);
    expect(noErpRefs.linked).toBe(false);

    await companies.unlinkErpCustomer(rep, c.id);
    expect((await companies.getCompany(rep, c.id)).customer).toBeNull();
    expect(await eventTypes(c.id)).toContain("company.erp_customer_unlinked");
    expect(await customerSnapshot(customer.id)).toEqual(before);
  });

  it("manages contacts: add existing (with move confirmation), set primary, remove — without duplicating contacts", async () => {
    const co = await companies.createCompany(rep, { name: name("Contact Hub") });
    const elsewhere = await companies.createCompany(rep, { name: name("Elsewhere") });
    const asha = await contacts.createContact(rep, { firstName: "Asha", lastName: run, crmCompanyId: co.id });
    const ravi = await contacts.createContact(rep, { firstName: "Ravi", lastName: run, crmCompanyId: elsewhere.id });
    expect(await eventTypes(co.id)).toContain("company.contact_added");

    await expect(relations.addContactToCompany(rep, co.id, { contactId: ravi.id })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION", details: { needsConfirmation: true } });
    await relations.addContactToCompany(rep, co.id, { contactId: ravi.id, moveFromOtherCompany: true, makePrimary: true });
    expect((await prisma.crmContact.findUniqueOrThrow({ where: { id: ravi.id } })).crmCompanyId).toBe(co.id);
    expect(await eventTypes(elsewhere.id)).toContain("company.contact_removed");

    const page1 = await relations.listCompanyContacts(rep, co.id, { page: 1, pageSize: 1, includeArchived: false });
    expect(page1.data).toHaveLength(1);
    expect(page1.meta.totalCount).toBe(2);
    expect(page1.primaryContactId).toBe(ravi.id);

    await relations.setPrimaryContact(rep, co.id, { contactId: asha.id });
    expect((await companies.getCompany(rep, co.id)).primaryContact?.id).toBe(asha.id);
    expect(await eventTypes(co.id)).toContain("company.primary_contact_changed");

    await relations.removeContactFromCompany(rep, co.id, asha.id);
    const after = await companies.getCompany(rep, co.id);
    expect(after.primaryContact).toBeNull();
    expect(after.counts.contacts).toBe(1);
    expect(await prisma.crmContact.count({ where: { id: asha.id } })).toBe(1);
    expect(await prisma.crmContact.count({ where: { lastName: run, firstName: { in: ["Asha", "Ravi"] } } })).toBe(2);
  });

  it("associates leads (and conversion), lists opportunities and shows related history on the timeline", async () => {
    const co = await companies.createCompany(rep, { name: name("Lead Magnet") });
    const lead = await leads.createLead(rep, { firstName: "Lina", lastName: run, email: `lina.${run}@example.test` });
    await relations.linkLeadToCompany(rep, co.id, { leadId: lead.id });
    expect((await relations.listCompanyLeads(rep, co.id, { page: 1, pageSize: 10, includeArchived: false })).data.map((l) => l.id)).toEqual([lead.id]);
    expect(await eventTypes(co.id)).toContain("company.lead_linked");

    await leads.convertLead(rep, lead.id, { company: { mode: "link", id: co.id }, contact: { mode: "create" }, opportunity: { create: true, name: `Deal ${run}`, amount: 50000, currencyCode: "INR" } });
    const opps = await relations.listCompanyOpportunities(rep, co.id, { page: 1, pageSize: 10, includeArchived: false });
    expect(opps.data.map((o) => o.name)).toEqual([`Deal ${run}`]);
    expect(opps.data[0]).toMatchObject({ pipeline: null, stage: null });
    expect(await eventTypes(co.id)).toContain("company.opportunity_linked");
    expect((await companies.getCompany(rep, co.id)).counts.openOpportunities).toBe(1);

    const own = await events.listCrmEvents(rep.companyId, { entityType: "COMPANY", entityId: co.id } as never, { page: 1, pageSize: 100, skip: 0, take: 100, sortBy: "occurredAt", sortOrder: "desc" } as never);
    expect(own.data.every((e) => e.entityType === "COMPANY")).toBe(true);
    const scope = await access.companyTimelineScope(rep, co.id, true);
    const withRelated = await events.listCrmEvents(rep.companyId, { entityType: "COMPANY", entityId: co.id } as never, { page: 1, pageSize: 100, skip: 0, take: 100, sortBy: "occurredAt", sortOrder: "desc" } as never, scope.companyIds, [
      { entityType: "CONTACT", ids: scope.contactIds },
      { entityType: "LEAD", ids: scope.leadIds },
    ]);
    expect(withRelated.data.some((e) => e.entityType === "LEAD" && e.entityId === lead.id)).toBe(true);

    await relations.unlinkLeadFromCompany(rep, co.id, lead.id);
    expect((await prisma.crmLead.findUniqueOrThrow({ where: { id: lead.id } })).crmCompanyId).toBeNull();
  });

  it("merges safely: conflicts must be chosen, related records move, ERP link is preserved, nothing is deleted", async () => {
    const customer = await mkCustomer("Mergeable");
    const before = await customerSnapshot(customer.id);
    const keep = await companies.createCompany(manager, { name: name("Merge Keep"), website: `keep-${run}.example`, city: null, customFields: {} });
    const partner = (await settings.listCompanyStatuses(manager.companyId)).find((s) => s.key === "partner")!;
    const gone = await companies.createCompany(manager, { name: name("Merge Keep Ltd"), website: `gone-${run}.example`, city: "Surat", statusId: partner.id, customerId: customer.id, confirmDuplicate: true, tagNames: [`merge-${run}`] });
    const contact = await contacts.createContact(manager, { firstName: "Moved", lastName: run, crmCompanyId: gone.id });
    await notes.createNote(manager, "COMPANY", gone.id, { body: "Trade fair lead" });
    const lead = await leads.createLead(manager, { firstName: "Merge", lastName: run, email: `merge.${run}@example.test` });
    await relations.linkLeadToCompany(manager, gone.id, { leadId: lead.id });

    const preview = await merge.getCompanyMergePreview(manager, keep.id, gone.id);
    expect(preview.conflicts).toEqual(expect.arrayContaining(["website", "statusId"]));
    expect(preview.erpConflict).toBe(false);
    expect(preview.erpLinkMoves).toBe(true);
    expect(preview.merged.counts).toMatchObject({ contacts: 1, leads: 1, notes: 1, tags: 1 });

    await expectCode(merge.mergeCompanies(manager, { survivorId: keep.id, mergedId: gone.id, survivorVersion: await version(keep.id), mergedVersion: await version(gone.id) }), "VALIDATION_ERROR");
    await expectCode(merge.mergeCompanies(manager, { survivorId: keep.id, mergedId: gone.id, fieldChoices: { website: "survivor", name: "survivor", statusId: "survivor" }, survivorVersion: 99, mergedVersion: await version(gone.id) }), "RECORD_VERSION_CONFLICT");

    const res = await merge.mergeCompanies(manager, { survivorId: keep.id, mergedId: gone.id, fieldChoices: { website: "survivor", name: "survivor", statusId: "survivor" }, survivorVersion: await version(keep.id), mergedVersion: await version(gone.id) });
    expect(res.survivor.id).toBe(keep.id);
    const survivor = await companies.getCompany(manager, keep.id);
    expect(survivor).toMatchObject({ website: `https://keep-${run}.example`, city: "Surat" });
    expect(survivor.customer?.id).toBe(customer.id);
    expect(survivor.tags.map((t) => t.name)).toContain(`merge-${run}`);
    expect(survivor.mergedCompanyIds).toContain(gone.id);
    expect((await prisma.crmContact.findUniqueOrThrow({ where: { id: contact.id } })).crmCompanyId).toBe(keep.id);
    expect((await prisma.crmLead.findUniqueOrThrow({ where: { id: lead.id } })).crmCompanyId).toBe(keep.id);
    const keptNotes = await notes.listNotes(manager, "COMPANY", keep.id);
    expect(keptNotes.some((n) => n.body.includes("Trade fair lead"))).toBe(true);
    const leftover = keptNotes.find((n) => n.body.startsWith("Values not kept"))!;
    expect(leftover.body).toContain(`gone-${run}.example`); // values not kept are written to a note
    expect(leftover.body).toContain(`Status: ${partner.name}`);
    expect(leftover.body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // references by name, never raw ids

    const old = await prisma.crmCompany.findUniqueOrThrow({ where: { id: gone.id } });
    expect(old).toMatchObject({ mergedIntoId: keep.id, customerId: null });
    expect(old.archivedAt).not.toBeNull();
    expect(await prisma.crmCompanyMerge.count({ where: { survivorId: keep.id, mergedId: gone.id } })).toBe(1);
    expect(await eventTypes(keep.id)).toEqual(expect.arrayContaining(["company.merged", "company.erp_customer_linked"]));
    expect((await list(manager, `search=${encodeURIComponent(name("merge keep"))}&archived=include`)).data.map((r) => r.id)).not.toContain(gone.id);
    await expectCode(merge.mergeCompanies(manager, { survivorId: keep.id, mergedId: gone.id, survivorVersion: await version(keep.id), mergedVersion: await version(gone.id) }), "INVALID_STATE_TRANSITION");
    expect(await customerSnapshot(customer.id)).toEqual(before);
  });

  it("refuses to merge companies linked to different ERP customers, and companies the user can't see", async () => {
    const [c1, c2] = await Promise.all([mkCustomer("ErpOne"), mkCustomer("ErpTwo")]);
    const a = await companies.createCompany(manager, { name: name("Erp A"), customerId: c1.id });
    const b = await companies.createCompany(manager, { name: name("Erp B"), customerId: c2.id });
    expect((await merge.getCompanyMergePreview(manager, a.id, b.id)).erpConflict).toBe(true);
    await expect(merge.mergeCompanies(manager, { survivorId: a.id, mergedId: b.id, survivorVersion: 1, mergedVersion: 1 })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION", details: { erpConflict: true } });

    const mine = await companies.createCompany(rep, { name: name("Mine Co") });
    const theirs = await companies.createCompany(otherRep, { name: name("Theirs Co") });
    await expectCode(merge.mergeCompanies(rep, { survivorId: mine.id, mergedId: theirs.id, survivorVersion: 1, mergedVersion: 1 }), "NOT_FOUND");
  });

  it("archives and restores without touching contacts, leads or the ERP customer", async () => {
    const customer = await mkCustomer("Archivable");
    const before = await customerSnapshot(customer.id);
    const co = await companies.createCompany(rep, { name: name("Archive Me"), customerId: customer.id });
    const contact = await contacts.createContact(rep, { firstName: "Stays", lastName: run, crmCompanyId: co.id });
    await companies.archiveCompany(rep, co.id);
    expect((await list(rep, `search=${encodeURIComponent(name("archive me"))}`)).data).toHaveLength(0);
    expect((await list(rep, `search=${encodeURIComponent(name("archive me"))}&archived=only`)).data.map((r) => r.id)).toEqual([co.id]);
    await expectCode(companies.updateCompany(rep, co.id, { version: await version(co.id), name: "x" }), "INVALID_STATE_TRANSITION");
    expect(await prisma.crmContact.findUniqueOrThrow({ where: { id: contact.id } })).toMatchObject({ crmCompanyId: co.id, archivedAt: null });
    await companies.restoreCompany(rep, co.id);
    expect((await companies.getCompany(rep, co.id)).archivedAt).toBeNull();
    expect(await eventTypes(co.id)).toEqual(expect.arrayContaining(["company.archived", "company.restored"]));
    expect(await customerSnapshot(customer.id)).toEqual(before);
  });

  it("updates with optimistic locking, status and owner changes recorded on the timeline", async () => {
    const co = await companies.createCompany(rep, { name: name("Versioned") });
    await expectCode(companies.updateCompany(rep, co.id, { version: 99, industry: "Retail chain" }), "RECORD_VERSION_CONFLICT");
    const updated = await companies.updateCompany(rep, co.id, { version: 1, industry: "Retail chain" });
    expect(updated.version).toBe(2);
    const statuses = await settings.listCompanyStatuses(rep.companyId);
    const customerStatus = statuses.find((s) => s.key === "customer")!;
    await companies.changeCompanyStatus(rep, co.id, { statusId: customerStatus.id, version: 2 });
    await companies.assignCompany(rep, co.id, { ownerUserId: otherRep.userId });
    expect(await eventTypes(co.id)).toEqual(expect.arrayContaining(["company.updated", "company.status_changed", "company.owner_changed"]));
    // After reassignment the rep (no view_all) no longer sees it.
    await expectCode(companies.getCompany(rep, co.id), "NOT_FOUND");
    expect((await companies.getCompany(otherRep, co.id)).status?.key).toBe("customer");
  });

  it("runs bulk actions with skipped reasons, and saved views for companies", async () => {
    const x = await companies.createCompany(rep, { name: name("Bulk X") });
    const y = await companies.createCompany(rep, { name: name("Bulk Y") });
    const hidden = await companies.createCompany(otherRep, { name: name("Bulk Hidden") });
    const r = await companies.bulkCompanyAction(rep, { action: "addTags", ids: [x.id, y.id, hidden.id], tagNames: [`bulk-${run}`] });
    expect(r).toMatchObject({ requested: 3, updated: 2 });
    expect(r.skipped.map((s) => s.id)).toEqual([hidden.id]);
    const tag = await prisma.crmTag.findFirstOrThrow({ where: { companyId: rep.companyId, name: `bulk-${run}` } });
    expect((await list(rep, `tagIds=${tag.id}`)).data.map((c) => c.id).sort()).toEqual([x.id, y.id].sort());
    expect((await companies.bulkCompanyAction(rep, { action: "archive", ids: [x.id] })).updated).toBe(1);

    const view = await views.createSavedView(rep, "COMPANY", { name: `Tagged ${run}`, filters: { tagIds: [tag.id], archived: "exclude" }, sort: { sortBy: "lastActivityAt", sortOrder: "desc" } });
    expect(view.entityType).toBe("COMPANY");
    await expectCode(views.createSavedView(rep, "COMPANY", { name: "bad", filters: {}, sort: { sortBy: "score", sortOrder: "desc" } }), "VALIDATION_ERROR");
  });

  it("stores documents through the ERP attachment service and guards access", async () => {
    const co = await companies.createCompany(rep, { name: name("Docs") });
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
    const att = await documents.uploadCrmDocument(rep, "COMPANY", co.id, { buffer: pdf, fileName: "profile.pdf", mimeType: "application/pdf" }, "Company profile");
    expect(att).toMatchObject({ relatedModule: "CRM_COMPANY", relatedRecordId: co.id, contextLabel: "Company profile" });
    expect((await documents.listCrmDocuments(rep, "COMPANY", co.id)).map((d) => d.id)).toEqual([att.id]);
    await expectCode(documents.downloadCrmDocument(otherRep, att.id), "NOT_FOUND");
    expect((await documents.downloadCrmDocument(rep, att.id)).buffer.equals(pdf)).toBe(true);
    expect(await eventTypes(co.id)).toContain("company.document_added");
    await documents.deleteCrmDocument(rep, att.id);
    expect(await prisma.attachment.count({ where: { id: att.id } })).toBe(0);
  });

  it("keeps company statuses consistent: one default, at least one active", async () => {
    const statuses = await settings.listCompanyStatuses(manager.companyId);
    const def = statuses.find((s) => s.isDefault)!;
    await expectCode(settings.updateCompanyStatus(manager, def.id, { isActive: false }), "VALIDATION_ERROR");
    const s = await settings.createCompanyStatus(manager, { name: `Key account ${run}`, color: "green" });
    await settings.updateCompanyStatus(manager, s.id, { isDefault: true });
    const after = await settings.listCompanyStatuses(manager.companyId);
    expect(after.filter((x) => x.isDefault).map((x) => x.id)).toEqual([s.id]);
    await settings.updateCompanyStatus(manager, def.id, { isDefault: true });
    await settings.updateCompanyStatus(manager, s.id, { isActive: false });
  });

  it("checks company timeline access for the caller", async () => {
    const co = await companies.createCompany(otherRep, { name: name("Private timeline") });
    await expectCode(access.assertCrmEntityAccess(rep, "COMPANY", co.id), "NOT_FOUND");
    await expect(access.assertCrmEntityAccess(manager, "COMPANY", co.id)).resolves.toBeUndefined();
  });
});
