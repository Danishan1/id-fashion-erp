/**
 * CRM Contacts (Phase 04) against a real, migrated + seeded Postgres database.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database (it
 * writes contacts, leads, users, notes, attachments…):
 *   CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/crm/contacts/contact.integration.test.ts
 *
 * Only permissions are mocked: `crm.view_all` is granted to the "manager"
 * test user and denied to the "rep" users; ERP module views are granted.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const viewAllUsers = new Set<string>();
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, _module: string, action: string) => (action === "view_all" ? viewAllUsers.has(userId) : true)),
    assert: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("CRM contacts (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const contacts = await import("./crm-contacts.service");
  const merge = await import("./contact-merge.service");
  const related = await import("./contact-related.service");
  const leads = await import("../leads/lead.service");
  const notes = await import("../notes/crm-notes.service");
  const settings = await import("../settings/crm-settings.service");
  const events = await import("../core/crm-events.service");
  const access = await import("../crm-entity-access");
  const views = await import("../saved-views/crm-saved-views.service");
  const { parseContactFilterParams } = await import("./contact.schema");

  const run = `c${Date.now().toString(36)}`;
  let manager: Actor;
  let rep: Actor;
  let otherRep: Actor;
  const base = String(Date.now()).slice(-7);
  const mobile = (n: number) => `9${n}${base}`.slice(0, 10).padEnd(10, "0");
  const email = (n: string) => `${n}.${run}@example.test`;
  const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });
  const sort = { sortBy: "createdAt" as const, sortOrder: "desc" as const };
  const page = { skip: 0, take: 50 };
  const list = (actor: Actor, qs: string) => contacts.listContacts(actor, parseContactFilterParams(new URLSearchParams(qs)), sort, page);
  const setRules = (over: Record<string, string>) =>
    settings.updateContactDuplicateRules(manager, {
      rules: [
        { rule: "EMAIL", action: "WARN" },
        { rule: "PHONE", action: "OFF" },
        { rule: "MOBILE", action: "WARN" },
        { rule: "WHATSAPP", action: "WARN" },
        { rule: "NAME_AND_COMPANY", action: "WARN" },
        { rule: "NAME_AND_EMAIL", action: "OFF" },
      ].map((r) => ({ ...r, action: over[r.rule] ?? r.action })),
    });

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@crm-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [m, r, o] = await Promise.all([mk("manager"), mk("rep"), mk("otherrep")]);
    manager = { companyId: company.id, userId: m.id, branchId: null };
    rep = { companyId: company.id, userId: r.id, branchId: null };
    otherRep = { companyId: company.id, userId: o.id, branchId: null };
    viewAllUsers.add(m.id);
    await setRules({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a contact with defaults, derived keys, address, channel, tags, audit and events", async () => {
    const c = await contacts.createContact(rep, {
      firstName: "Asha",
      middleName: "K",
      lastName: "Rao",
      email: email("asha").toUpperCase(),
      mobile: `+91 ${mobile(1)}`,
      designation: "Buyer",
      addresses: [{ line1: "12 MG Road", city: "Bengaluru", country: "India" }],
      channels: [{ channelType: "EMAIL", value: email("asha.personal") }],
      tagNames: [`vip-${run}`],
    });
    expect(c).toMatchObject({ fullName: "Asha K Rao", nameKey: "asha k rao", email: email("asha"), ownerUserId: rep.userId, version: 1 });
    expect(c.emailKeys).toEqual([email("asha"), email("asha.personal")]);
    expect(c.phoneKeys).toEqual([mobile(1)]);
    const source = await prisma.crmLeadSource.findUniqueOrThrow({ where: { id: c.sourceId! } });
    expect(source.key).toBe("manual");
    const detail = await contacts.getContact(rep, c.id);
    expect(detail.addresses).toHaveLength(1);
    expect(detail.addresses[0].isPrimary).toBe(true);
    expect(detail.channels.map((ch) => ch.value)).toEqual([email("asha.personal")]);
    expect(detail.tags.map((t) => t.name)).toEqual([`vip-${run}`]);
    expect((await prisma.crmEvent.findMany({ where: { entityId: c.id }, orderBy: { occurredAt: "asc" } })).map((e) => e.eventType)).toEqual(["contact.created", "contact.tag_added"]);
    expect(await prisma.auditLog.count({ where: { recordId: c.id, tableName: "crm_contacts", action: "CREATE" } })).toBe(1);
    expect(detail.lastActivityAt).not.toBeNull();
  });

  it("applies contact duplicate rules: WARN needs confirmation, extra channels count, BLOCK refuses, FLAG saves and marks", async () => {
    await expectCode(contacts.createContact(rep, { firstName: "Other", mobile: mobile(1) }), "CRM_POSSIBLE_DUPLICATE");
    await expectCode(contacts.createContact(rep, { firstName: "Other", email: email("asha.personal") }), "CRM_POSSIBLE_DUPLICATE");
    const confirmed = await contacts.createContact(rep, { firstName: "Other", mobile: mobile(1), confirmDuplicate: true });
    expect(confirmed.duplicateFlaggedAt).toBeNull();

    await setRules({ MOBILE: "BLOCK" });
    await expect(contacts.createContact(rep, { firstName: "Third", mobile: mobile(1), confirmDuplicate: true })).rejects.toMatchObject({ code: "CRM_DUPLICATE_RECORD", details: { blocking: true } });

    await setRules({ MOBILE: "FLAG" });
    const flagged = await contacts.createContact(rep, { firstName: "Fourth", mobile: mobile(1) });
    expect(flagged.duplicateFlaggedAt).not.toBeNull();
    expect(flagged.flaggedDuplicateIds.length).toBeGreaterThanOrEqual(2);
    expect((await list(rep, "duplicateFlagged=true")).data.map((r) => r.id)).toContain(flagged.id);
    const cleared = await contacts.dismissDuplicateFlag(rep, flagged.id);
    expect(cleared.flaggedDuplicateIds).toEqual([]);
    await setRules({});

    // A shared office landline is not a duplicate by default.
    const p1 = await contacts.createContact(rep, { firstName: "Desk", lastName: "One", phone: "044 2345 6789" });
    const p2 = await contacts.createContact(rep, { firstName: "Desk", lastName: "Two", phone: "044 2345 6789" });
    expect(p2.id).not.toBe(p1.id);
  });

  it("links an ERP customer through one CRM company and lists the customer's ERP references", async () => {
    const customer = await prisma.customer.findFirst({ where: { companyId: manager.companyId } });
    if (!customer) return;
    const before = await prisma.crmCompany.findFirst({ where: { customerId: customer.id } });
    const c1 = await contacts.createContact(manager, { firstName: "Buyer", lastName: `One ${run}`, customerId: customer.id });
    const c2 = await contacts.createContact(manager, { firstName: "Buyer", lastName: `Two ${run}`, customerId: customer.id });
    expect(c1.crmCompanyId).toBeTruthy();
    expect(c2.crmCompanyId).toBe(c1.crmCompanyId);
    const company = await prisma.crmCompany.findUniqueOrThrow({ where: { id: c1.crmCompanyId! } });
    expect(company.customerId).toBe(customer.id);
    if (before) expect(company.id).toBe(before.id);
    const refs = await related.getContactErpReferences(manager, c1.id);
    expect(refs.linked).toBe(true);
    if (refs.linked) {
      expect(refs.customer?.id).toBe(customer.id);
      expect(refs.sections.map((s) => s.key)).toEqual(["buyerEnquiries", "salesOrders", "salesInvoices", "receipts"]);
      const orders = await prisma.salesOrder.count({ where: { customerId: customer.id } });
      expect(refs.sections[1].total).toBe(orders);
    }
    // Name + company duplicate rule now applies to people at that customer.
    await expectCode(contacts.createContact(manager, { firstName: "Buyer", lastName: `One ${run}`, customerId: customer.id }), "CRM_POSSIBLE_DUPLICATE");
  });

  it("enforces version checks, tracks changes and owner history", async () => {
    const c = await contacts.createContact(rep, { firstName: "Vik", lastName: "Shah", email: email("vik") });
    await expectCode(contacts.updateContact(rep, c.id, { version: 99, designation: "Owner" }), "RECORD_VERSION_CONFLICT");
    const u = await contacts.updateContact(rep, c.id, { version: c.version, designation: "Owner", department: "Management", ownerUserId: otherRep.userId });
    expect(u).toMatchObject({ designation: "Owner", department: "Management", ownerUserId: otherRep.userId, version: c.version + 1 });
    const types = (await prisma.crmEvent.findMany({ where: { entityId: c.id } })).map((e) => e.eventType);
    expect(types).toEqual(expect.arrayContaining(["contact.updated", "contact.owner_changed"]));
    // Now owned by someone else → invisible to rep (OWN scope), visible to manager.
    await expectCode(contacts.getContact(rep, c.id), "NOT_FOUND");
    expect((await contacts.getContact(manager, c.id)).id).toBe(c.id);
    expect((await list(otherRep, `search=${encodeURIComponent(email("vik"))}`)).data.map((r) => r.id)).toEqual([c.id]);
  });

  it("records contactability per channel with reasons, and filters / checks it", async () => {
    const c = await contacts.createContact(rep, { firstName: "Dnd", lastName: run, email: email("dnd"), whatsapp: mobile(7) });
    await expectCode(contacts.setContactability(rep, c.id, { channel: "WHATSAPP", status: "UNSUBSCRIBED" }), "VALIDATION_ERROR");
    await contacts.setContactability(rep, c.id, { channel: "WHATSAPP", status: "UNSUBSCRIBED", reason: "Replied STOP", source: "CUSTOMER_REQUEST" });
    expect(await contacts.canContactContact(rep, c.id, "WHATSAPP")).toMatchObject({ allowed: false, decidedBy: "WHATSAPP" });
    expect(await contacts.canContactContact(rep, c.id, "EMAIL")).toMatchObject({ allowed: true });
    await contacts.setContactability(rep, c.id, { channel: "ALL", status: "DO_NOT_CONTACT", reason: "Legal request" });
    expect(await contacts.canContactContact(rep, c.id, "EMAIL")).toMatchObject({ allowed: false, decidedBy: "ALL" });
    expect((await list(rep, "dndChannels=EMAIL")).data.map((r) => r.id)).toContain(c.id);
    const row = (await list(rep, `search=${encodeURIComponent(email("dnd"))}`)).data[0];
    expect(row.restrictedChannels.sort()).toEqual(["ALL", "WHATSAPP"]);
    const ev = await prisma.crmEvent.findMany({ where: { entityId: c.id, eventType: "contact.contactability_changed" } });
    expect(ev).toHaveLength(2);
    // Archived contacts can still get a DND recorded.
    await contacts.archiveContact(rep, c.id);
    await contacts.setContactability(rep, c.id, { channel: "PHONE", status: "DO_NOT_CONTACT", reason: "Archived but asked" });
  });

  it("archives and restores; archived contacts can't be edited and leave the default list", async () => {
    const c = await contacts.createContact(rep, { firstName: "Arch", lastName: run });
    await contacts.archiveContact(rep, c.id);
    await expectCode(contacts.updateContact(rep, c.id, { version: 2, designation: "x" }), "INVALID_STATE_TRANSITION");
    expect((await list(rep, `search=arch ${run}`)).data).toHaveLength(0);
    expect((await list(rep, `search=arch ${run}&archived=only`)).data).toHaveLength(1);
    await contacts.restoreContact(rep, c.id);
    expect((await list(rep, `search=arch ${run}`)).data).toHaveLength(1);
  });

  it("manages addresses (one primary) and channels (keys refresh)", async () => {
    const c = await contacts.createContact(rep, { firstName: "Addr", lastName: run });
    const a1 = await contacts.addContactAddress(rep, c.id, { line1: "A street", city: "Surat" });
    const a2 = await contacts.addContactAddress(rep, c.id, { line1: "B street", city: "Tiruppur", isPrimary: true });
    let addrs = await prisma.crmAddress.findMany({ where: { contactId: c.id } });
    expect(addrs.find((a) => a.id === a1.id)!.isPrimary).toBe(false);
    expect(addrs.find((a) => a.id === a2.id)!.isPrimary).toBe(true);
    await contacts.deleteContactAddress(rep, c.id, a2.id);
    addrs = await prisma.crmAddress.findMany({ where: { contactId: c.id } });
    expect(addrs).toHaveLength(1);
    expect(addrs[0].isPrimary).toBe(true);
    expect((await list(rep, "location=surat")).data.map((r) => r.id)).toContain(c.id);

    const ch = await contacts.addContactChannel(rep, c.id, { channelType: "MOBILE", value: mobile(8) });
    expect((await prisma.crmContact.findUniqueOrThrow({ where: { id: c.id } })).phoneKeys).toContain(mobile(8));
    await expectCode(contacts.addContactChannel(rep, c.id, { channelType: "MOBILE", value: `+91 ${mobile(8)}` }), "VALIDATION_ERROR");
    await contacts.removeContactChannel(rep, c.id, ch.id);
    expect((await prisma.crmContact.findUniqueOrThrow({ where: { id: c.id } })).phoneKeys).not.toContain(mobile(8));
    await expectCode(contacts.addContactChannel(rep, c.id, { channelType: "WEBSITE", value: "not a url" }), "VALIDATION_ERROR");
  });

  it("converts a lead into a new contact (source + lead link) or links an existing one, never silently duplicating", async () => {
    const lead = await leads.createLead(rep, { firstName: "Leela", lastName: run, email: email("leela"), mobile: mobile(3), designation: "Merchandiser" });
    const res = await leads.convertLead(rep, lead.id, { company: { mode: "none" }, contact: { mode: "create" }, opportunity: { create: false } });
    const contact = await prisma.crmContact.findUniqueOrThrow({ where: { id: res.crmContactId! } });
    expect(contact).toMatchObject({ sourceLeadId: lead.id, sourceId: lead.sourceId, email: email("leela"), designation: "Merchandiser" });
    expect((await list(rep, "fromLead=yes")).data.map((r) => r.id)).toContain(contact.id);

    const lead2 = await leads.createLead(rep, { firstName: "Leela", lastName: run, email: email("leela"), confirmDuplicate: true });
    await expect(leads.convertLead(rep, lead2.id, { company: { mode: "none" }, contact: { mode: "create" }, opportunity: { create: false } })).rejects.toMatchObject({
      code: "CRM_DUPLICATE_RECORD",
      details: { entityType: "CONTACT", blocking: false },
    });
    await leads.convertLead(rep, lead2.id, { company: { mode: "none" }, contact: { mode: "link", id: contact.id }, opportunity: { create: false } });
    expect(await prisma.crmEvent.count({ where: { entityId: contact.id, eventType: "contact.lead_linked" } })).toBe(1);
    const rel = await related.getContactRelated(rep, contact.id);
    expect(rel.leads.map((l) => l.id).sort()).toEqual([lead.id, lead2.id].sort());
  });

  it("merges two contacts in one transaction, moving everything and keeping the merged one", async () => {
    const survivor = await contacts.createContact(rep, { firstName: "Meera", lastName: "Iyer", email: email("meera"), mobile: mobile(4), tagNames: [`a-${run}`] });
    const dup = await contacts.createContact(rep, {
      firstName: "Meera",
      lastName: "Iyer",
      email: email("meera.work"),
      mobile: mobile(5),
      designation: "Head of Sourcing",
      tagNames: [`a-${run}`, `b-${run}`],
      addresses: [{ line1: "Dup street", city: "Noida", isPrimary: true }],
      channels: [{ channelType: "LINKEDIN", value: "https://linkedin.com/in/meera" }],
    });
    await contacts.setContactability(rep, dup.id, { channel: "EMAIL", status: "UNSUBSCRIBED", reason: "Unsubscribed" });
    const note = await notes.createNote(rep, "CONTACT", dup.id, { body: "Met at the trade fair" });
    const lead = await leads.createLead(rep, { firstName: "Meera", lastName: run, email: email("meera.lead") });
    await leads.convertLead(rep, lead.id, { company: { mode: "none" }, contact: { mode: "link", id: dup.id }, opportunity: { create: false } });
    const s0 = await prisma.crmContact.findUniqueOrThrow({ where: { id: survivor.id } });
    const d0 = await prisma.crmContact.findUniqueOrThrow({ where: { id: dup.id } });

    await expectCode(merge.mergeContacts(rep, { survivorId: survivor.id, mergedId: dup.id, survivorVersion: 99, mergedVersion: d0.version }), "RECORD_VERSION_CONFLICT");
    await expect(merge.mergeContacts(rep, { survivorId: survivor.id, mergedId: survivor.id, survivorVersion: 1, mergedVersion: 1 })).rejects.toThrow();

    const preview = await merge.getMergePreview(rep, survivor.id, dup.id);
    expect(preview.merged.counts).toMatchObject({ leads: 1, notes: 1, tags: 2, addresses: 1, channels: 1 });

    const result = await merge.mergeContacts(rep, { survivorId: survivor.id, mergedId: dup.id, survivorVersion: s0.version, mergedVersion: d0.version, fieldChoices: { mobile: "merged" } });
    expect(result.moved).toMatchObject({ leads: 1, notes: 1, addresses: 1 });

    const s = await prisma.crmContact.findUniqueOrThrow({ where: { id: survivor.id }, include: { channels: true, addresses: true, consents: true } });
    const d = await prisma.crmContact.findUniqueOrThrow({ where: { id: dup.id } });
    expect(s.mobile).toBe(mobile(5));
    expect(s.designation).toBe("Head of Sourcing"); // empty on the survivor → filled
    expect(s.email).toBe(email("meera"));
    // Nothing lost: the other email and the old mobile became extra channels.
    expect(s.channels.map((c) => c.value)).toEqual(expect.arrayContaining([email("meera.work"), mobile(4), "https://linkedin.com/in/meera"]));
    expect(s.emailKeys).toEqual(expect.arrayContaining([email("meera"), email("meera.work")]));
    expect(s.addresses.map((a) => a.line1)).toContain("Dup street");
    expect(s.consents.find((c) => c.channel === "EMAIL")).toMatchObject({ status: "UNSUBSCRIBED", source: "MERGE" });
    expect(d).toMatchObject({ mergedIntoId: survivor.id, mergedByUserId: rep.userId });
    expect(d.archivedAt).not.toBeNull();
    expect(await prisma.crmLead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ crmContactId: survivor.id });
    expect(await prisma.crmNote.findUniqueOrThrow({ where: { id: note.id } })).toMatchObject({ entityId: survivor.id });
    expect((await contacts.getContact(rep, survivor.id)).tags.map((t) => t.name).sort()).toEqual([`a-${run}`, `b-${run}`]);
    const record = await prisma.crmContactMerge.findUniqueOrThrow({ where: { mergedId: dup.id } });
    expect(record.survivorId).toBe(survivor.id);
    expect((record.mergedSnapshot as { contact: { email: string } }).contact.email).toBe(email("meera.work"));

    // Timeline of the survivor includes the merged contact's history.
    const ids = await access.mergedContactIds(rep.companyId, survivor.id);
    expect(ids).toEqual([dup.id]);
    const timeline = await events.listCrmEvents(rep.companyId, { entityType: "CONTACT", entityId: survivor.id }, { page: 1, pageSize: 100, skip: 0, take: 100, sortOrder: "desc", sortBy: "occurredAt" } as never, ids);
    expect(timeline.data.map((e) => e.eventType)).toEqual(expect.arrayContaining(["contact.merged", "contact.merged_into", "contact.note_added", "contact.created"]));

    // Merged contacts: never listed, read-only, can't be merged again.
    expect((await list(rep, `search=meera iyer&archived=include`)).data.map((r) => r.id)).toEqual([survivor.id]);
    await expectCode(contacts.updateContact(rep, dup.id, { version: d.version, designation: "x" }), "INVALID_STATE_TRANSITION");
    await expectCode(merge.mergeContacts(rep, { survivorId: survivor.id, mergedId: dup.id, survivorVersion: 1, mergedVersion: d.version }), "INVALID_STATE_TRANSITION");
    await expectCode(merge.mergeContacts(rep, { survivorId: dup.id, mergedId: survivor.id, survivorVersion: d.version, mergedVersion: 1 }), "INVALID_STATE_TRANSITION");
    expect(await contacts.canContactContact(rep, dup.id, "EMAIL")).toMatchObject({ allowed: false }); // follows the merge
  });

  it("serialises concurrent merges of the same contact: exactly one wins", async () => {
    const a = await contacts.createContact(rep, { firstName: "Race", lastName: `A ${run}` });
    const b = await contacts.createContact(rep, { firstName: "Race", lastName: `B ${run}` });
    const c = await contacts.createContact(rep, { firstName: "Race", lastName: `C ${run}` });
    const results = await Promise.allSettled([
      merge.mergeContacts(rep, { survivorId: a.id, mergedId: b.id, survivorVersion: 1, mergedVersion: 1 }),
      merge.mergeContacts(rep, { survivorId: c.id, mergedId: b.id, survivorVersion: 1, mergedVersion: 1 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.crmContactMerge.count({ where: { mergedId: b.id } })).toBe(1);
  });

  it("refuses merging a contact the user can't see", async () => {
    const mine = await contacts.createContact(rep, { firstName: "Mine", lastName: run });
    const theirs = await contacts.createContact(otherRep, { firstName: "Theirs", lastName: run });
    await expectCode(merge.mergeContacts(rep, { survivorId: mine.id, mergedId: theirs.id, survivorVersion: 1, mergedVersion: 1 }), "NOT_FOUND");
  });

  it("stores documents through the ERP attachment service, moves them on merge and guards access", async () => {
    const a = await contacts.createContact(rep, { firstName: "Doc", lastName: `A ${run}` });
    const b = await contacts.createContact(rep, { firstName: "Doc", lastName: `B ${run}` });
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
    const att = await related.uploadContactDocument(rep, b.id, { buffer: pdf, fileName: "price-list.pdf", mimeType: "application/pdf" }, "Price list");
    expect(att).toMatchObject({ relatedModule: "CRM_CONTACT", relatedRecordId: b.id, contextLabel: "Price list" });
    expect((await related.listContactDocuments(rep, b.id)).map((d) => d.id)).toEqual([att.id]);
    await expectCode(related.downloadContactDocument(otherRep, att.id), "NOT_FOUND");
    await merge.mergeContacts(rep, { survivorId: a.id, mergedId: b.id, survivorVersion: 1, mergedVersion: (await prisma.crmContact.findUniqueOrThrow({ where: { id: b.id } })).version });
    expect((await related.listContactDocuments(rep, a.id)).map((d) => d.id)).toEqual([att.id]);
    const { buffer } = await related.downloadContactDocument(rep, att.id);
    expect(buffer.equals(pdf)).toBe(true);
    await related.deleteContactDocument(rep, att.id);
    expect(await prisma.attachment.count({ where: { id: att.id } })).toBe(0);
  });

  it("runs bulk actions with skipped reasons, and bumps last activity on notes", async () => {
    const x = await contacts.createContact(rep, { firstName: "Bulk", lastName: `X ${run}` });
    const y = await contacts.createContact(rep, { firstName: "Bulk", lastName: `Y ${run}` });
    const hidden = await contacts.createContact(otherRep, { firstName: "Bulk", lastName: `Z ${run}` });
    const r = await contacts.bulkContactAction(rep, { action: "addTags", ids: [x.id, y.id, hidden.id], tagNames: [`bulk-${run}`] });
    expect(r).toMatchObject({ requested: 3, updated: 2 });
    expect(r.skipped).toEqual([{ id: hidden.id, reason: "Not found or not visible to you" }]);
    const tag = await prisma.crmTag.findFirstOrThrow({ where: { companyId: rep.companyId, nameKey: `bulk-${run}` } });
    expect((await list(rep, `tagIds=${tag.id}`)).data.map((c) => c.id).sort()).toEqual([x.id, y.id].sort());
    const again = await contacts.bulkContactAction(rep, { action: "addTags", ids: [x.id], tagIds: [tag.id] });
    expect(again.skipped[0].reason).toBe("Already has these tags");

    await prisma.crmContact.update({ where: { id: x.id }, data: { lastActivityAt: new Date("2020-01-01") } });
    await notes.createNote(rep, "CONTACT", x.id, { body: "Called" });
    expect((await prisma.crmContact.findUniqueOrThrow({ where: { id: x.id } })).lastActivityAt!.getFullYear()).toBeGreaterThan(2020);
  });

  it("saves contact views with validated filters", async () => {
    const v = await views.createSavedView(rep, "CONTACT", { name: `DND ${run}`, filters: { dndChannels: ["ALL"], archived: "exclude" }, sort: { sortBy: "lastActivityAt", sortOrder: "desc" } });
    expect(v.entityType).toBe("CONTACT");
    await expectCode(views.createSavedView(rep, "CONTACT", { name: "bad", filters: {}, sort: { sortBy: "score", sortOrder: "desc" } }), "VALIDATION_ERROR");
  });
});
