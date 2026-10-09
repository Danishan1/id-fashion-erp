/**
 * Lead flows against a real, migrated + seeded Postgres database.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database (it
 * writes leads, users, tags, notes…). Example:
 *   createdb -T <seeded db> crm_it
 *   CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/crm/leads/lead.integration.test.ts
 *
 * Permissions are the only thing mocked: `crm.view_all` is granted to the
 * "manager" test user and denied to the "rep" users, so record scope is
 * exercised without depending on seeded roles.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const viewAllUsers = new Set<string>();
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, _module: string, action: string) => (action === "view_all" ? viewAllUsers.has(userId) : true)),
    assert: vi.fn(async () => undefined),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("CRM leads (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const leads = await import("./lead.service");
  const notes = await import("../notes/crm-notes.service");
  const settings = await import("../settings/crm-settings.service");
  const customFields = await import("../custom-fields/crm-custom-fields.service");
  const views = await import("../saved-views/crm-saved-views.service");

  const run = `it${Date.now().toString(36)}`;
  let manager: Actor;
  let rep: Actor;
  let otherRep: Actor;

  const expectCode = async (p: Promise<unknown>, code: string) => {
    await expect(p).rejects.toMatchObject({ code });
  };
  const email = (n: string) => `${n}.${run}@example.test`;
  // Unique 10-digit numbers per run so earlier runs never count as duplicates.
  const base = String(Date.now()).slice(-8);
  const phone = (n: number) => `9${n}${base}`.slice(0, 10);

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const mk = (n: string) =>
      prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@crm-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [m, r, o] = await Promise.all([mk("manager"), mk("rep"), mk("otherrep")]);
    manager = { companyId: company.id, userId: m.id, branchId: null };
    rep = { companyId: company.id, userId: r.id, branchId: null };
    otherRep = { companyId: company.id, userId: o.id, branchId: null };
    viewAllUsers.add(m.id);
    // Known rule state for this run.
    await settings.updateLeadDuplicateRules(manager, {
      rules: [
        { rule: "EMAIL", action: "WARN" },
        { rule: "PHONE", action: "WARN" },
        { rule: "COMPANY_AND_EMAIL", action: "OFF" },
        { rule: "COMPANY_AND_PHONE", action: "OFF" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a lead with defaults, a number, an audit row and a lead.created event", async () => {
    const lead = await leads.createLead(rep, { firstName: "Asha", lastName: "Rao", companyName: `Rao Exports ${run}`, email: email("asha"), phone: `+91 ${phone(1)}`, tagNames: [`vip-${run}`] });
    expect(lead.leadNumber).toMatch(/LEAD/);
    expect(lead.ownerUserId).toBe(rep.userId);
    expect(lead.email).toBe(email("asha"));
    expect(lead.phoneKeys).toContain(phone(1));
    const status = await prisma.crmLeadStatus.findUniqueOrThrow({ where: { id: lead.statusId } });
    expect(status.isDefault).toBe(true);
    const source = await prisma.crmLeadSource.findUniqueOrThrow({ where: { id: lead.sourceId! } });
    expect(source.key).toBe("manual");
    const events = await prisma.crmEvent.findMany({ where: { entityId: lead.id } });
    expect(events.map((e) => e.eventType)).toEqual(["lead.created"]);
    expect(await prisma.auditLog.count({ where: { recordId: lead.id, tableName: "crm_leads", action: "CREATE" } })).toBe(1);
    const detail = await leads.getLead(rep, lead.id);
    expect(detail.tags.map((t) => t.name)).toEqual([`vip-${run}`]);
  });

  it("warns on a duplicate email/phone and saves only after confirmation", async () => {
    await leads.createLead(rep, { firstName: "Dup", email: email("dup"), phone: phone(2) });
    await expectCode(leads.createLead(rep, { firstName: "Dup Again", email: email("DUP").toUpperCase() }), "CRM_POSSIBLE_DUPLICATE");
    await expectCode(leads.createLead(rep, { firstName: "Dup Phone", mobile: `+91-${phone(2)}` }), "CRM_POSSIBLE_DUPLICATE");
    const saved = await leads.createLead(rep, { firstName: "Dup Again", email: email("dup"), confirmDuplicate: true });
    expect(saved.id).toBeTruthy();
    const check = await leads.checkLeadDuplicates(rep, { email: email("dup") });
    expect(check.matches.length).toBe(2);
    expect(check.matches[0].rules).toContain("EMAIL");
  });

  it("blocks a duplicate when the rule is BLOCK, and ignores rules that are OFF", async () => {
    await leads.createLead(rep, { firstName: "Block", email: email("block") });
    await settings.updateLeadDuplicateRules(manager, { rules: [{ rule: "EMAIL", action: "BLOCK" }] });
    try {
      await expectCode(leads.createLead(rep, { firstName: "Block 2", email: email("block"), confirmDuplicate: true }), "DUPLICATE_LEAD_EXISTS");
      await settings.updateLeadDuplicateRules(manager, { rules: [{ rule: "EMAIL", action: "OFF" }] });
      const ok = await leads.createLead(rep, { firstName: "Block 3", email: email("block") });
      expect(ok.id).toBeTruthy();
    } finally {
      await settings.updateLeadDuplicateRules(manager, { rules: [{ rule: "EMAIL", action: "WARN" }] });
    }
  });

  it("updates with optimistic locking and records changed fields", async () => {
    const lead = await leads.createLead(rep, { firstName: "Vik", email: email("vik") });
    const updated = await leads.updateLead(rep, lead.id, { version: lead.version, city: "Tiruppur", score: 40 });
    expect(updated.city).toBe("Tiruppur");
    expect(updated.version).toBe(lead.version + 1);
    await expectCode(leads.updateLead(rep, lead.id, { version: lead.version, city: "Stale" }), "RECORD_VERSION_CONFLICT");
    const ev = await prisma.crmEvent.findFirstOrThrow({ where: { entityId: lead.id, eventType: "lead.updated" } });
    expect(JSON.stringify(ev.payload)).toContain("city");
  });

  it("changes status and owner with timeline events, and refuses the Converted status directly", async () => {
    const lead = await leads.createLead(rep, { firstName: "Status", email: email("status") });
    const statuses = await settings.listLeadStatuses(rep.companyId);
    const contacted = statuses.find((s) => s.kind === "OPEN" && !s.isDefault && s.isActive)!;
    const converted = statuses.find((s) => s.kind === "CONVERTED")!;
    const after = await leads.changeLeadStatus(rep, lead.id, { statusId: contacted.id, version: lead.version });
    expect(after.statusId).toBe(contacted.id);
    await expectCode(leads.changeLeadStatus(rep, lead.id, { statusId: converted.id }), "VALIDATION_ERROR");
    const assigned = await leads.assignLead(rep, lead.id, { ownerUserId: otherRep.userId });
    expect(assigned.ownerUserId).toBe(otherRep.userId);
    const types = (await prisma.crmEvent.findMany({ where: { entityId: lead.id }, orderBy: { occurredAt: "asc" } })).map((e) => e.eventType);
    expect(types).toEqual(["lead.created", "lead.status_changed", "lead.owner_changed"]);
  });

  it("scopes visibility: reps see leads they own or created; crm.view_all sees all", async () => {
    const mine = await leads.createLead(rep, { firstName: "Mine", email: email("mine") });
    const theirs = await leads.createLead(otherRep, { firstName: "Theirs", email: email("theirs") });
    const handedOver = await leads.createLead(otherRep, { firstName: "Handed", email: email("handed"), ownerUserId: rep.userId });
    const page = { skip: 0, take: 200 };
    const sort = { sortBy: "createdAt" as const, sortOrder: "desc" as const };
    const repIds = (await leads.listLeads(rep, { search: run, archived: "exclude" }, sort, page)).data.map((l) => l.id);
    expect(repIds).toEqual(expect.arrayContaining([mine.id, handedOver.id]));
    expect(repIds).not.toContain(theirs.id);
    await expectCode(leads.getLead(rep, theirs.id), "NOT_FOUND");
    await expectCode(leads.updateLead(rep, theirs.id, { version: 1, city: "x" }), "NOT_FOUND");
    const allIds = (await leads.listLeads(manager, { search: run, archived: "exclude" }, sort, page)).data.map((l) => l.id);
    expect(allIds).toEqual(expect.arrayContaining([mine.id, theirs.id, handedOver.id]));
  });

  it("searches, filters and sorts on the server", async () => {
    const tag = `filter-${run}`;
    const a = await leads.createLead(rep, { firstName: "Filter", lastName: "Alpha", companyName: `Zeta Knits ${run}`, score: 80, temperature: "HOT", tagNames: [tag], email: email("fa") });
    const b = await leads.createLead(rep, { firstName: "Filter", lastName: "Beta", companyName: `Zeta Knits ${run}`, score: 20, temperature: "COLD", email: email("fb") });
    const page = { skip: 0, take: 50 };
    const list = (filter: object, sort: { sortBy: "score"; sortOrder: "asc" | "desc" } = { sortBy: "score", sortOrder: "desc" }) =>
      leads.listLeads(rep, { archived: "exclude", ...filter }, sort, page).then((r) => r.data.map((l) => l.id));
    expect(await list({ search: `zeta knits ${run}` })).toEqual([a.id, b.id]);
    expect(await list({ search: `zeta knits ${run}` }, { sortBy: "score", sortOrder: "asc" })).toEqual([b.id, a.id]);
    expect(await list({ search: run, temperatures: ["HOT"] })).toEqual([a.id]);
    expect(await list({ search: run, score: { min: 50 } })).toContain(a.id);
    expect(await list({ search: run, score: { min: 50 } })).not.toContain(b.id);
    const tagRow = await prisma.crmTag.findFirstOrThrow({ where: { companyId: rep.companyId, name: tag } });
    expect(await list({ tagIds: [tagRow.id] })).toEqual([a.id]);
    expect(await list({ search: phone(1) })).not.toContain(b.id);
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    expect(await list({ search: run, createdAt: { from: today, to: today } })).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  it("archives and restores; archived leads leave the default list and can't be edited", async () => {
    const lead = await leads.createLead(rep, { firstName: "Arch", email: email("arch") });
    await leads.archiveLead(rep, lead.id);
    const page = { skip: 0, take: 50 };
    const sort = { sortBy: "createdAt" as const, sortOrder: "desc" as const };
    expect((await leads.listLeads(rep, { search: email("arch"), archived: "exclude" }, sort, page)).data).toHaveLength(0);
    expect((await leads.listLeads(rep, { search: email("arch"), archived: "only" }, sort, page)).data).toHaveLength(1);
    const fresh = await leads.getLead(rep, lead.id);
    await expectCode(leads.updateLead(rep, lead.id, { version: fresh.version, city: "x" }), "INVALID_STATE_TRANSITION");
    await expectCode(leads.archiveLead(rep, lead.id), "INVALID_STATE_TRANSITION");
    const restored = await leads.restoreLead(rep, lead.id);
    expect(restored.archivedAt).toBeNull();
  });

  it("runs bulk actions and reports what was skipped and why", async () => {
    const a = await leads.createLead(rep, { firstName: "Bulk A", email: email("ba") });
    const b = await leads.createLead(rep, { firstName: "Bulk B", email: email("bb") });
    const hidden = await leads.createLead(otherRep, { firstName: "Bulk Hidden", email: email("bh") });
    const archived = await leads.createLead(rep, { firstName: "Bulk Archived", email: email("bx") });
    await leads.archiveLead(rep, archived.id);
    const res = await leads.bulkLeadAction(rep, { action: "addTags", ids: [a.id, b.id, hidden.id, archived.id], tagNames: [`bulk-${run}`] });
    expect(res.updated).toBe(2);
    expect(res.skipped).toEqual(
      expect.arrayContaining([
        { id: hidden.id, reason: "Not found or not visible to you" },
        { id: archived.id, reason: "Archived" },
      ])
    );
    const again = await leads.bulkLeadAction(rep, { action: "addTags", ids: [a.id], tagNames: [`bulk-${run}`] });
    expect(again).toMatchObject({ updated: 0, skipped: [{ id: a.id, reason: "Already has these tags" }] });
    const assign = await leads.bulkLeadAction(rep, { action: "assign", ids: [a.id, b.id], ownerUserId: otherRep.userId });
    expect(assign.updated).toBe(2);
    expect(await prisma.crmEvent.count({ where: { entityId: { in: [a.id, b.id] }, eventType: "lead.owner_changed" } })).toBe(2);
  });

  it("converts a lead (A: new company + contact + opportunity) and links it all", async () => {
    const lead = await leads.createLead(rep, { firstName: "Conv", lastName: "One", companyName: `Conv Co ${run}`, email: email("conv1"), estimatedValue: 50000 });
    const res = await leads.convertLead(rep, lead.id, {
      company: { mode: "create", name: `Conv Co ${run}` },
      contact: { mode: "create" },
      opportunity: { create: true, name: "First order" },
    });
    expect(res.crmCompanyId && res.crmContactId && res.opportunityId).toBeTruthy();
    const contact = await prisma.crmContact.findUniqueOrThrow({ where: { id: res.crmContactId! } });
    expect(contact.crmCompanyId).toBe(res.crmCompanyId);
    expect(contact.email).toBe(email("conv1"));
    const opp = await prisma.crmOpportunity.findUniqueOrThrow({ where: { id: res.opportunityId! } });
    expect(Number(opp.amount)).toBe(50000);
    expect(opp.leadId).toBe(lead.id);
    const after = await leads.getLead(rep, lead.id);
    expect(after.convertedAt).not.toBeNull();
    expect(after.status.kind).toBe("CONVERTED");
    await expectCode(leads.convertLead(rep, lead.id, { company: { mode: "none" }, contact: { mode: "create" }, opportunity: { create: false } }), "INVALID_STATE_TRANSITION");
    await expectCode(leads.changeLeadStatus(rep, lead.id, { statusId: after.statusId }), "INVALID_STATE_TRANSITION");
  });

  it("never silently duplicates a company or contact on conversion (B: link existing, C: contact only)", async () => {
    const first = await leads.createLead(rep, { firstName: "Link", companyName: `Link Co ${run}`, email: email("link1") });
    const r1 = await leads.convertLead(rep, first.id, { company: { mode: "create", name: `Link Co ${run}` }, contact: { mode: "create" }, opportunity: { create: false } });

    const second = await leads.createLead(rep, { firstName: "Link", lastName: "Two", companyName: `link co ${run}`, email: email("link2") });
    const suggestions = await leads.getConversionSuggestions(rep, second.id);
    expect(suggestions.companyMatches.map((c) => c.id)).toContain(r1.crmCompanyId);
    await expectCode(
      leads.convertLead(rep, second.id, { company: { mode: "create", name: `LINK CO ${run}` }, contact: { mode: "create" }, opportunity: { create: false } }),
      "CRM_DUPLICATE_RECORD"
    );
    // Nothing was written by the refused attempt.
    expect(await prisma.crmCompany.count({ where: { companyId: rep.companyId, name: { equals: `Link Co ${run}`, mode: "insensitive" } } })).toBe(1);
    const r2 = await leads.convertLead(rep, second.id, { company: { mode: "link", id: r1.crmCompanyId! }, contact: { mode: "create" }, opportunity: { create: false } });
    expect(r2.crmCompanyId).toBe(r1.crmCompanyId);

    // C: contact only — and the same person again must link, not duplicate.
    const third = await leads.createLead(rep, { firstName: "Solo", email: email("solo") });
    const r3 = await leads.convertLead(rep, third.id, { company: { mode: "none" }, contact: { mode: "create" }, opportunity: { create: false } });
    expect(r3.crmCompanyId).toBeNull();
    const fourth = await leads.createLead(rep, { firstName: "Solo", email: email("solo"), confirmDuplicate: true });
    await expectCode(leads.convertLead(rep, fourth.id, { company: { mode: "none" }, contact: { mode: "create" }, opportunity: { create: false } }), "CRM_DUPLICATE_RECORD");
    const r4 = await leads.convertLead(rep, fourth.id, { company: { mode: "none" }, contact: { mode: "link", id: r3.crmContactId! }, opportunity: { create: false } });
    expect(r4.crmContactId).toBe(r3.crmContactId);
  });

  it("creates an opportunity from an unconverted lead", async () => {
    const lead = await leads.createLead(rep, { firstName: "Opp", email: email("opp"), estimatedValue: 1200, requirement: "5k tees" });
    const opp = await leads.createOpportunityFromLead(rep, lead.id, { name: "Tees" });
    expect(opp.opportunityNumber).toMatch(/OPP/);
    expect(Number(opp.amount)).toBe(1200);
    const detail = await leads.getLead(rep, lead.id);
    expect(detail.opportunities.map((o) => o.id)).toContain(opp.id);
    expect(detail.convertedAt).toBeNull();
  });

  it("validates custom field values against their definitions", async () => {
    const key = `qty_${run}`.slice(0, 40);
    await customFields.createCustomField(manager, "LEAD", { label: `Qty ${run}`, key, fieldType: "NUMBER", isRequired: false });
    const lead = await leads.createLead(rep, { firstName: "Custom", email: email("cf"), customFields: { [key]: "250" } });
    expect((lead.customFields as Record<string, unknown>)[key]).toBe(250);
    await expectCode(leads.createLead(rep, { firstName: "Custom bad", email: email("cf2"), customFields: { [key]: "lots" } }), "VALIDATION_ERROR");
  });

  it("lets only the author edit a note; authors and view_all can delete", async () => {
    const lead = await leads.createLead(rep, { firstName: "Notes", email: email("notes"), ownerUserId: rep.userId });
    const note = await notes.createNote(rep, "LEAD", lead.id, { body: "Called, wants samples" });
    await expectCode(notes.updateNote(manager, note.id, { body: "edited by manager" }), "PERMISSION_DENIED");
    const edited = await notes.updateNote(rep, note.id, { body: "Called, wants 3 samples" });
    expect(edited.editedAt).not.toBeNull();
    await expectCode(notes.createNote(otherRep, "LEAD", lead.id, { body: "can't see it" }), "NOT_FOUND");
    await notes.deleteNote(manager, note.id);
    expect(await notes.listNotes(rep, "LEAD", lead.id)).toHaveLength(0);
    const types = (await prisma.crmEvent.findMany({ where: { entityId: lead.id } })).map((e) => e.eventType);
    expect(types).toEqual(expect.arrayContaining(["lead.note_added", "lead.note_updated", "lead.note_deleted"]));
  });

  it("guards settings: the default status and system sources stay usable", async () => {
    const statuses = await settings.listLeadStatuses(manager.companyId);
    const def = statuses.find((s) => s.isDefault)!;
    await expectCode(settings.updateLeadStatus(manager, def.id, { isActive: false }), "VALIDATION_ERROR");
    const sources = await settings.listLeadSources(manager.companyId);
    const system = sources.find((s) => s.isSystem)!;
    await expectCode(settings.updateLeadSource(manager, system.id, { isActive: false }), "VALIDATION_ERROR");
    const custom = await settings.createLeadSource(manager, { name: `Trade fair ${run}` });
    const off = await settings.updateLeadSource(manager, custom.id, { isActive: false });
    expect(off.isActive).toBe(false);
  });

  it("keeps saved views private unless shared, and only the owner can change them", async () => {
    const view = await views.createSavedView(rep, "LEAD", { name: `Hot ${run}`, filters: { temperatures: ["HOT"] }, visibility: "PRIVATE" });
    expect((await views.listSavedViews(otherRep, "LEAD")).map((v) => v.id)).not.toContain(view.id);
    await expectCode(views.updateSavedView(otherRep, view.id, { name: "mine now" }), "NOT_FOUND");
    await views.updateSavedView(rep, view.id, { visibility: "SHARED" });
    await expectCode(views.updateSavedView(otherRep, view.id, { name: "mine now" }), "PERMISSION_DENIED");
    expect((await views.listSavedViews(otherRep, "LEAD")).map((v) => v.id)).toContain(view.id);
    await expect(views.createSavedView(rep, "LEAD", { name: "bad", filters: { notAFilter: 1 } })).rejects.toMatchObject({ name: "ZodError" });
  });
});
