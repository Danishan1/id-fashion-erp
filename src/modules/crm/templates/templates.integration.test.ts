/**
 * CRM message templates (Phase 12) against a real, migrated + seeded Postgres
 * database: CRUD, immutable versions, categories (crm_option_values), lifecycle,
 * rendering with real CRM records, previews, test sends through the provider
 * adapter (HTTP mocked at fetch), and sending from a template in the Inbox.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database:
 *   CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/crm/templates/templates.integration.test.ts
 *
 * Only permissions are mocked: `crm.view_all` is granted to "manager".
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;
process.env.NEXTAUTH_SECRET ??= "integration-test-secret";

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

describe.skipIf(!DB_URL)("CRM message templates (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const svc = await import("./crm-templates.service");
  const channels = await import("../conversations/crm-channels.service");
  const messaging = await import("../conversations/conversation-messaging.service");
  const companies = await import("../companies/crm-companies.service");
  const contacts = await import("../contacts/crm-contacts.service");
  const opps = await import("../opportunities/crm-opportunities.service");
  const leads = await import("../leads/lead.service");
  const settings = await import("../settings/crm-settings.service");
  const { signGenericPayload } = await import("@/core/communication/providers/generic-webhook.provider");
  const { parseTemplateFilterParams } = await import("./template.schema");
  const { crmSystemActor } = await import("../core/crm-mutation");

  const run = `tp${Date.now().toString(36)}`;
  let manager: Actor;
  let rep: Actor;
  let otherRep: Actor;
  let co: { id: string };
  let ct: { id: string };
  let opp: { id: string };
  let wa: { id: string; secret: string };
  let mail: { id: string; secret: string };
  let sms: { id: string; secret: string };
  let categories: { id: string; value: string }[];
  const phone = `+91 9${String(Date.now()).slice(-6)}321`;
  const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });
  const events = async (id: string) => (await prisma.crmEvent.findMany({ where: { entityId: id }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] })).map((e) => e.eventType);
  const audits = async (id: string) => prisma.auditLog.findMany({ where: { recordId: id }, orderBy: [{ performedAt: "asc" }, { id: "asc" }] });
  const fetchMock = vi.fn();
  const ok = (id: string) => Promise.resolve(new Response(JSON.stringify({ messageId: id }), { status: 200, headers: { "Content-Type": "application/json" } }));
  const list = (actor: Actor, params: Record<string, string> = {}, search?: string, sortBy = "updatedAt", sortOrder: "asc" | "desc" = "desc") => svc.listTemplates(actor, parseTemplateFilterParams(new URLSearchParams(params)), { sortBy, sortOrder }, { skip: 0, take: 100, search });
  const cat = (name: string) => categories.find((c) => c.value === name)!.id;
  const fresh = (id: string) => svc.getTemplate(manager, id);

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const mk = (u: string, n: string) => prisma.user.create({ data: { companyId: company.id, email: `${u}.${run}@crm-it.local`, passwordHash: "x", fullName: `${n} ${run}`, phone: "+91 98200 55555" } });
    const [m, r, o] = await Promise.all([mk("tpmanager", "Meera Manager"), mk("tprep", "Ashish Rep"), mk("tpother", "Zoya Other")]);
    manager = { companyId: company.id, userId: m.id, branchId: null };
    rep = { companyId: company.id, userId: r.id, branchId: null };
    otherRep = { companyId: company.id, userId: o.id, branchId: null };
    viewAllUsers.add(m.id);
    co = await companies.createCompany(rep, { name: `ABC Textiles ${run}`, city: "Mumbai", country: "India", email: `info.${run}@abc.example` });
    ct = await contacts.createContact(rep, { firstName: "Rahul", lastName: `Sharma ${run}`, mobile: phone, email: `rahul.${run}@abc.example`, crmCompanyId: co.id });
    opp = await opps.createOpportunity(rep, { name: `Website Project ${run}`, crmCompanyId: co.id, crmContactId: ct.id, amount: 250000, currencyCode: "INR" });
    wa = await channels.createChannel(manager, { channelType: "WHATSAPP", name: `WA ${run}`, config: { outboundUrl: "https://relay.example.com/wa" } });
    mail = await channels.createChannel(manager, { channelType: "EMAIL", name: `Mail ${run}`, config: { outboundUrl: "https://relay.example.com/mail" } });
    sms = await channels.createChannel(manager, { channelType: "SMS", name: `SMS ${run}` }); // receive-only (no outbound URL)
    categories = (await settings.listOptionValues(company.id)).filter((o) => o.listKey === "template_category");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => fetchMock.mockReset());
  afterAll(async () => {
    vi.unstubAllGlobals();
    await prisma.$disconnect();
  });

  // ── Categories ──

  it("seeds configurable categories in crm_option_values and manages them with the existing settings service", async () => {
    expect(categories.map((c) => c.value)).toEqual(expect.arrayContaining(["General", "Sales", "Follow-up", "Appointment", "Quotation", "Payment", "Support", "Onboarding", "Marketing", "Internal"]));
    const created = await settings.createOptionValue(manager, { listKey: "template_category", value: `Collections ${run}` });
    await settings.updateOptionValue(manager, created.id, { value: `Payments due ${run}` });
    const meta = await svc.templateMeta(manager);
    expect(meta.categories.find((c) => c.id === created.id)).toMatchObject({ name: `Payments due ${run}`, archived: false });
    await settings.updateOptionValue(manager, created.id, { isActive: false });
    // Archived category can't be chosen for a template.
    await expectCode(svc.createTemplate(rep, { name: `T archived cat ${run}`, channelType: "SMS", categoryId: created.id, body: "x" }), "VALIDATION_ERROR");
    // A category from another list is refused.
    const otherList = (await settings.listOptionValues(manager.companyId)).find((o) => o.listKey === "contact_department")!;
    await expectCode(svc.createTemplate(rep, { name: `T wrong list ${run}`, channelType: "SMS", categoryId: otherList.id, body: "x" }), "VALIDATION_ERROR");
  });

  // ── CRUD + versions ──

  let quote: { id: string };
  it("creates a DRAFT with version 1, an audit row and a template.created event", async () => {
    quote = await svc.createTemplate(rep, { name: `Quotation ready ${run}`, channelType: "EMAIL", categoryId: cat("Quotation"), description: "Sent when a quotation is ready", subject: "Your quotation for {{company.name}}", body: "Hi {{contact.first_name|there}},\n\nYour opportunity {{opportunity.name}} is worth {{opportunity.value}}.\n\n{{user.name}}" });
    const t = await fresh(quote.id);
    expect(t).toMatchObject({ status: "DRAFT", channelType: "EMAIL", currentVersionNumber: 1, versionCount: 1, category: { name: "Quotation" }, createdBy: { id: rep.userId }, usageCount: 0 });
    expect(t.currentVersion).toMatchObject({ versionNumber: 1, subject: "Your quotation for {{company.name}}", variables: ["company.name", "contact.first_name", "opportunity.name", "opportunity.value", "user.name"], changeNote: "First version" });
    expect(t.validation).toMatchObject({ valid: true });
    expect(await events(quote.id)).toEqual(["template.created"]);
    const a = await audits(quote.id);
    expect(a.map((x) => [x.tableName, x.action])).toEqual([["crm_message_templates", "CREATE"]]);
    expect(await prisma.auditLog.count({ where: { recordId: t.currentVersion!.id, tableName: "crm_message_template_versions" } })).toBe(1);
  });

  it("validates on create: unsupported channel, missing name, duplicate name, subject on SMS", async () => {
    await expectCode(svc.createTemplate(rep, { name: `IG ${run}`, channelType: "INSTAGRAM", body: "x" }), "CRM_TEMPLATE_INVALID");
    await expect(svc.createTemplate(rep, { name: " ", channelType: "SMS", body: "x" })).rejects.toThrow();
    await expectCode(svc.createTemplate(rep, { name: `quotation READY ${run}`, channelType: "SMS", body: "x" }), "VALIDATION_ERROR");
    await expectCode(svc.createTemplate(rep, { name: `SMS subj ${run}`, channelType: "SMS", subject: "Hi", body: "x" }), "CRM_TEMPLATE_INVALID");
  });

  it("detail edits change in place; content edits add version 2, 3… and never touch older versions", async () => {
    const t1 = await fresh(quote.id);
    const v1 = t1.currentVersion!;
    // details only → no new version
    const r1 = await svc.updateTemplate(rep, quote.id, { version: t1.version, description: "Updated description", categoryId: cat("Sales") });
    expect(r1).toMatchObject({ versionCreated: false, versionNumber: 1 });
    const t2 = await fresh(quote.id);
    expect(t2).toMatchObject({ description: "Updated description", category: { name: "Sales" }, currentVersionNumber: 1, updatedBy: { id: rep.userId } });
    // content → version 2
    const r2 = await svc.updateTemplate(rep, quote.id, { version: t2.version, body: "Hi {{contact.first_name|there}}, your quotation for {{opportunity.name}} is ready.", changeNote: "Shorter" });
    expect(r2).toMatchObject({ versionCreated: true, versionNumber: 2 });
    // stale version → conflict
    await expectCode(svc.updateTemplate(rep, quote.id, { version: t2.version, body: "x" }), "RECORD_VERSION_CONFLICT");
    // same content again → no version
    const t3 = await fresh(quote.id);
    expect(await svc.updateTemplate(rep, quote.id, { version: t3.version, body: t3.currentVersion!.body })).toMatchObject({ versionCreated: false });
    const r3 = await svc.updateTemplate(rep, quote.id, { version: t3.version, subject: "Quotation for {{company.name}} ({{opportunity.name}})" });
    expect(r3.versionNumber).toBe(3);
    const versions = await svc.listTemplateVersions(manager, quote.id);
    expect(versions.map((v) => [v.versionNumber, v.isCurrent])).toEqual([
      [3, true],
      [2, false],
      [1, false],
    ]);
    const old = await svc.getTemplateVersion(manager, quote.id, v1.id);
    expect(old).toMatchObject({ versionNumber: 1, subject: v1.subject, body: v1.body, isCurrent: false });
    expect(await events(quote.id)).toEqual(["template.created", "template.updated", "template.version_created", "template.version_created"]);
  });

  it("the database refuses to rewrite or delete a version", async () => {
    const v1 = (await svc.listTemplateVersions(manager, quote.id)).find((v) => v.versionNumber === 1)!;
    await expect(prisma.crmMessageTemplateVersion.update({ where: { id: v1.id }, data: { body: "rewritten" } })).rejects.toThrow(/immutable/);
    await expect(prisma.crmMessageTemplateVersion.delete({ where: { id: v1.id } })).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE crm_message_template_versions SET body = 'x' WHERE id = '${v1.id}'`)).rejects.toThrow(/immutable/);
    expect((await prisma.crmMessageTemplateVersion.findUniqueOrThrow({ where: { id: v1.id } })).body).toBe(v1.body);
  });

  it("restoring an old version creates a NEW version with its content", async () => {
    const t = await fresh(quote.id);
    const v1 = (await svc.listTemplateVersions(manager, quote.id)).find((v) => v.versionNumber === 1)!;
    const r = await svc.restoreTemplateVersion(rep, quote.id, v1.id, { version: t.version });
    expect(r.versionNumber).toBe(4);
    const after = await fresh(quote.id);
    expect(after.currentVersion).toMatchObject({ versionNumber: 4, body: v1.body, subject: v1.subject, restoredFromId: v1.id, changeNote: "Restored version 1" });
    expect((await svc.listTemplateVersions(manager, quote.id)).find((v) => v.versionNumber === 4)).toMatchObject({ restoredFromNumber: 1 });
    await expectCode(svc.restoreTemplateVersion(rep, quote.id, after.currentVersion!.id, { version: after.version }), "INVALID_STATE_TRANSITION");
    expect((await events(quote.id)).at(-1)).toBe("template.version_restored");
  });

  it("lifecycle: drafts may hold errors but can't be activated; active templates must stay valid", async () => {
    const t = await svc.createTemplate(rep, { name: `Broken ${run}`, channelType: "SMS", body: "Hi {{customer.xyz}} {{contact.first_name}}" });
    let d = await fresh(t.id);
    expect(d.validation).toMatchObject({ valid: false });
    expect(d.validation!.errors[0].message).toBe("Template contains unsupported variable: {{customer.xyz}}.");
    await expect(svc.changeTemplateStatus(rep, t.id, "activate", { version: d.version })).rejects.toMatchObject({ code: "CRM_TEMPLATE_INVALID", details: { errors: [expect.objectContaining({ code: "UNKNOWN_VARIABLE" })] } });
    await svc.updateTemplate(rep, t.id, { version: d.version, body: "Hi {{contact.first_name|there}}, your order is ready." });
    d = await fresh(t.id);
    await svc.changeTemplateStatus(rep, t.id, "activate", { version: d.version });
    d = await fresh(t.id);
    expect(d).toMatchObject({ status: "ACTIVE", activatedBy: { id: rep.userId } });
    await expectCode(svc.updateTemplate(rep, t.id, { version: d.version, body: "Hi {{oops.field}}" }), "CRM_TEMPLATE_INVALID");
    await expectCode(svc.changeTemplateStatus(rep, t.id, "activate", { version: d.version }), "INVALID_STATE_TRANSITION");
    await svc.changeTemplateStatus(rep, t.id, "deactivate", { version: d.version });
    d = await fresh(t.id);
    await svc.changeTemplateStatus(rep, t.id, "archive", { version: d.version });
    d = await fresh(t.id);
    expect(d).toMatchObject({ status: "ARCHIVED", archivedBy: { id: rep.userId } });
    expect(d.archivedAt).not.toBeNull();
    await expectCode(svc.updateTemplate(rep, t.id, { version: d.version, name: "x" }), "INVALID_STATE_TRANSITION");
    // the name is free again while archived; restore refuses if it's been taken
    const clash = await svc.createTemplate(rep, { name: `Broken ${run}`, channelType: "SMS", body: "x" });
    await expectCode(svc.changeTemplateStatus(rep, t.id, "restore", { version: d.version }), "VALIDATION_ERROR");
    const c = await fresh(clash.id);
    await svc.updateTemplate(rep, clash.id, { version: c.version, name: `Broken 2 ${run}` });
    await svc.changeTemplateStatus(rep, t.id, "restore", { version: d.version });
    expect((await fresh(t.id)).status).toBe("DRAFT");
    expect(await events(t.id)).toEqual(["template.created", "template.version_created", "template.activated", "template.deactivated", "template.archived", "template.restored"]);
    const statusAudits = (await audits(t.id)).map((a) => (a.newValues as { event?: string } | null)?.event).filter(Boolean);
    expect(statusAudits).toEqual(expect.arrayContaining(["template.activated", "template.archived", "template.restored"]));
  });

  it("duplicates into a new template with its own id and history", async () => {
    const src = await fresh(quote.id);
    const dup = await svc.duplicateTemplate(rep, quote.id, {});
    const d = await fresh(dup.id);
    expect(d.id).not.toBe(src.id);
    expect(d).toMatchObject({ name: `Quotation ready ${run} (copy)`, status: "DRAFT", currentVersionNumber: 1, versionCount: 1, duplicatedFrom: { id: src.id }, category: { name: "Sales" } });
    expect(d.currentVersion).toMatchObject({ body: src.currentVersion!.body, subject: src.currentVersion!.subject });
    const named = await svc.duplicateTemplate(rep, quote.id, { name: `Follow-up — Day 3 ${run}` });
    expect((await fresh(named.id)).name).toBe(`Follow-up — Day 3 ${run}`);
    expect((await svc.duplicateTemplate(rep, quote.id, {})).id).toBeTruthy();
    expect((await fresh((await list(rep, {}, `${run} (copy 2)`)).data[0].id)).name).toBe(`Quotation ready ${run} (copy 2)`);
    expect(await events(quote.id)).toContain("template.duplicated");
    await expectCode(svc.duplicateTemplate(rep, quote.id, { name: `Quotation ready ${run}` }), "VALIDATION_ERROR");
  });

  it("lists without bodies: search (name + text), filters, sort, paging; archived only on request", async () => {
    const all = await list(rep, {}, run);
    expect(all.data.every((r) => !("body" in r))).toBe(true);
    expect(all.data.every((r) => r.status !== "ARCHIVED")).toBe(true);
    expect((await list(rep, {}, "your quotation for")).data.map((r) => r.id)).toContain(quote.id); // current text
    expect((await list(rep, { channels: "SMS" }, run)).data.every((r) => r.channelType === "SMS")).toBe(true);
    expect((await list(rep, { categoryIds: cat("Sales") }, run)).data.map((r) => r.id)).toContain(quote.id);
    expect((await list(rep, { statuses: "ARCHIVED" }, run)).data.every((r) => r.status === "ARCHIVED")).toBe(true);
    expect((await list(rep, { usable: "true" }, run)).data.every((r) => r.status === "ACTIVE")).toBe(true);
    const byName = await list(rep, {}, run, "name", "asc");
    expect(byName.data.map((r) => r.name)).toEqual([...byName.data.map((r) => r.name)].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    const page = await svc.listTemplates(rep, parseTemplateFilterParams(new URLSearchParams()), { sortBy: "createdAt", sortOrder: "desc" }, { skip: 0, take: 2, search: run });
    expect(page.data).toHaveLength(2);
    expect(page.totalCount).toBe(all.totalCount);
    expect(all.data.find((r) => r.id === quote.id)).toMatchObject({ currentVersionNumber: 4, category: { name: "Sales" }, updatedBy: { id: rep.userId } });
  });

  // ── Rendering & preview ──

  it("renders with real records: contact, company, opportunity, lead, user and appointment", async () => {
    const lead = await leads.createLead(rep, { firstName: "Neha", lastName: `Kapoor ${run}`, email: `neha.${run}@x.example` });
    const appt = await prisma.crmActivity.create({ data: { companyId: rep.companyId, type: "APPOINTMENT", status: "SCHEDULED", subject: "Product demo", entityType: "OPPORTUNITY", entityId: opp.id, dueAt: new Date("2026-10-15T05:30:00Z"), endAt: new Date("2026-10-15T06:30:00Z"), timezone: "Asia/Kolkata", location: "Lower Parel office", videoLink: "https://meet.example.com/demo", createdByUserId: rep.userId, assignedToUserId: rep.userId } });
    const body = ["{{contact.first_name}} {{contact.company}}", "{{company.name}} | {{company.address}}", "{{opportunity.name}} | {{opportunity.value}} | {{opportunity.stage}}", "{{lead.first_name}} {{lead.status}} {{lead.score}}", "{{user.name}} {{user.phone}}", "{{appointment.title}} {{appointment.date}} {{appointment.time}}-{{appointment.end_time}} {{appointment.timezone}} {{appointment.location}} {{appointment.meeting_link}}"].join("\n");
    const r = await svc.previewDraft(rep, { channelType: "WHATSAPP", body, context: { appointmentId: appt.id, leadId: lead.id } });
    const lines = r.body.split("\n");
    expect(lines[0]).toBe(`Rahul ABC Textiles ${run}`); // contact derived via the appointment's opportunity
    expect(lines[1]).toBe(`ABC Textiles ${run} | Mumbai, India`);
    expect(lines[2]).toMatch(new RegExp(`^Website Project ${run} \\| INR 2,50,000\\.00 \\| .+$`));
    expect(lines[3]).toMatch(/^Neha .+ \d+$/);
    expect(lines[4]).toBe(`Ashish Rep ${run} +91 98200 55555`);
    expect(lines[5]).toBe("Product demo Thu, 15 Oct, 2026 11:00 am-12:00 pm IST Lower Parel office https://meet.example.com/demo");
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("previews with sample data by default, flags missing records and values, and enforces record visibility", async () => {
    const sample = await svc.previewTemplate(rep, quote.id, {});
    expect(sample.body).toContain("Hi Rahul,");
    expect(sample.subject).toBe("Your quotation for ABC Textiles");
    const onlyContact = await svc.previewTemplate(rep, quote.id, { context: { contactId: ct.id } });
    // contact brings its company; no opportunity → warning, value empty
    expect(onlyContact.subject).toBe(`Your quotation for ABC Textiles ${run}`);
    expect(onlyContact.body).toContain("Your opportunity  is worth .");
    expect(onlyContact.warnings).toEqual([expect.objectContaining({ code: "NO_CONTEXT", message: "Opportunity data is unavailable for this message." })]);
    const bare = await contacts.createContact(rep, { firstName: "Bare", lastName: run });
    await prisma.crmContact.update({ where: { id: bare.id }, data: { firstName: "" } });
    const fb = await svc.previewDraft(rep, { channelType: "SMS", body: "Hi {{contact.first_name|there}} / {{contact.email}}", context: { contactId: bare.id } });
    expect(fb.body).toBe("Hi there / ");
    expect(fb.warnings.map((w) => w.code)).toEqual(["NO_VALUE"]);
    // otherRep can't see rep's contact → 404, never its data
    await expectCode(svc.previewTemplate(otherRep, quote.id, { context: { contactId: ct.id } }), "NOT_FOUND");
    // system actor (automation) renders through the same contract
    const auto = await svc.TemplateService.renderTemplate(crmSystemActor(rep.companyId), quote.id, { refs: { opportunityId: opp.id } });
    expect(auto.body).toContain(`Hi Rahul,`);
    expect(auto.ok).toBe(true);
  });

  // ── Test send ──

  it("test send: one explicit address, rendered, marked [TEST], through the provider adapter; nothing stored as a conversation", async () => {
    const before = await prisma.crmMessage.count();
    fetchMock.mockImplementationOnce(() => ok(`mail-test-${run}`));
    const r = await svc.sendTemplateTest(rep, quote.id, { channelId: mail.id, to: "ashish@example.com", confirm: true });
    expect(r).toMatchObject({ ok: true, to: "ashish@example.com", providerMessageId: `mail-test-${run}`, versionNumber: 4 });
    expect(r.subject).toBe("[TEST] Your quotation for ABC Textiles");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://relay.example.com/mail");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-CRM-Signature"]).toBe(signGenericPayload(mail.secret, headers["X-CRM-Timestamp"], String(init.body)));
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ test: true, to: { kind: "EMAIL", value: "ashish@example.com" }, subject: "[TEST] Your quotation for ABC Textiles", template: { templateId: quote.id, versionNumber: 4 } });
    expect(sent.text).toContain("Hi Rahul,");
    expect(await prisma.crmMessage.count()).toBe(before);
    expect((await events(quote.id)).at(-1)).toBe("template.test_sent");
    const audit = (await audits(quote.id)).at(-1)!;
    expect(audit.newValues).toMatchObject({ event: "template.test_sent", test: true, to: "ashish@example.com", ok: true });
  });

  it("test send refuses lists, wrong channels, receive-only channels and invalid templates; reports provider failures", async () => {
    await expectCode(svc.sendTemplateTest(rep, quote.id, { channelId: mail.id, to: "a@x.com, b@x.com", confirm: true }), "VALIDATION_ERROR");
    await expect(svc.sendTemplateTest(rep, quote.id, { channelId: mail.id, to: "a@x.com" })).rejects.toThrow(); // no confirmation
    await expectCode(svc.sendTemplateTest(rep, quote.id, { channelId: wa.id, to: phone, confirm: true }), "VALIDATION_ERROR");
    const smsT = await svc.createTemplate(rep, { name: `SMS ok ${run}`, channelType: "SMS", body: "Hi {{contact.first_name}}" });
    await expectCode(svc.sendTemplateTest(rep, smsT.id, { channelId: sms.id, to: phone, confirm: true }), "CRM_CHANNEL_UNAVAILABLE");
    const broken = await svc.createTemplate(rep, { name: `WA broken ${run}`, channelType: "WHATSAPP", body: "Hi {{customer.xyz}}" });
    await expectCode(svc.sendTemplateTest(rep, broken.id, { channelId: wa.id, to: phone, confirm: true }), "CRM_TEMPLATE_INVALID");
    expect(fetchMock).not.toHaveBeenCalled();
    const waT = await svc.createTemplate(rep, { name: `WA ok ${run}`, channelType: "WHATSAPP", body: "Hello {{contact.first_name|there}}", providerMetadata: { externalTemplateName: "hello_v1", language: "en" } });
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response("{\"error\":\"secret internals\"}", { status: 500 })));
    const fail = svc.sendTemplateTest(otherRep, waT.id, { channelId: wa.id, to: "+91 98100 99999", confirm: true });
    await expect(fail).rejects.toMatchObject({ code: "CRM_CHANNEL_UNAVAILABLE", message: "Test not sent: The provider rejected the message (HTTP 500)." });
    await fail.catch((e: Error) => expect(e.message).not.toContain("secret"));
    const audit = (await audits(waT.id)).at(-1)!;
    expect(audit.newValues).toMatchObject({ event: "template.test_sent", ok: false, errorCode: "PROVIDER_HTTP_500" });
    expect(await events(waT.id)).not.toContain("template.test_sent");
    fetchMock.mockImplementationOnce(() => ok(`wa-test-${run}`));
    await svc.sendTemplateTest(otherRep, waT.id, { channelId: wa.id, to: "+91 98100 99999", confirm: true });
    const body = JSON.parse(String((fetchMock.mock.calls.at(-1) as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ test: true, text: "[TEST] Hello Rahul", template: { providerMetadata: { externalTemplateName: "hello_v1", language: "en" }, parameters: [{ key: "contact.first_name", value: "Rahul" }] } });
  });

  it("test sends are rate limited per user", async () => {
    const waT = (await list(rep, { channels: "WHATSAPP" }, `WA ok ${run}`)).data[0];
    fetchMock.mockImplementation(() => ok(`wa-rl-${crypto.randomUUID()}`));
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await svc.sendTemplateTest(manager, waT.id, { channelId: wa.id, to: "+91 98100 77777", confirm: true }).then(() => "ok", (e) => e.code));
    expect(results.filter((r) => r === "RATE_LIMITED").length).toBeGreaterThanOrEqual(2);
  });

  // ── Inbox ──

  it("sends an Inbox reply from a template: stores the rendered text + exact version; later edits never change it", async () => {
    // inbound WhatsApp message from Rahul → matched conversation with company + opportunity
    const raw = JSON.stringify({ type: "message", id: `in-${run}`, from: { phone }, text: "Any update?" });
    const ts = Math.floor(Date.now() / 1000);
    const res = await messaging.handleChannelWebhook({ providerKey: "generic", channelId: wa.id, headers: new Headers({ "x-crm-timestamp": String(ts), "x-crm-signature": signGenericPayload(wa.secret, ts, raw) }), rawBody: raw });
    const conversationId = (res as unknown as { results: { conversationId: string }[] }).results[0].conversationId;
    const t = await svc.createTemplate(rep, { name: `Status update ${run}`, channelType: "WHATSAPP", body: "Hi {{contact.first_name}}, {{opportunity.name}} is at {{opportunity.stage}}." });
    let d = await fresh(t.id);
    const preview = await svc.previewTemplate(rep, t.id, { context: { conversationId } });
    expect(preview.body).toMatch(new RegExp(`^Hi Rahul, Website Project ${run} is at .+\\.$`));
    // drafts can't be used
    await expectCode(messaging.sendConversationMessage(rep, conversationId, { body: preview.body, templateId: t.id, templateVersionId: d.currentVersion!.id }), "INVALID_STATE_TRANSITION");
    await svc.changeTemplateStatus(rep, t.id, "activate", { version: d.version });
    d = await fresh(t.id);
    fetchMock.mockImplementationOnce(() => ok(`wamid-tpl-${run}`));
    const m = await messaging.sendConversationMessage(rep, conversationId, { body: preview.body, templateId: t.id, templateVersionId: d.currentVersion!.id });
    expect(m).toMatchObject({ status: "SENT", body: preview.body, template: { id: t.id, versionId: d.currentVersion!.id, versionNumber: 1, edited: false, name: `Status update ${run}` } });
    const relay = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(relay.template).toMatchObject({ templateId: t.id, versionNumber: 1, parameters: [{ key: "contact.first_name", value: "Rahul" }, expect.anything(), expect.anything()] });
    expect(relay).not.toHaveProperty("test");
    const sentEvent = await prisma.crmEvent.findFirstOrThrow({ where: { entityId: conversationId, eventType: "message.sent" }, orderBy: { occurredAt: "desc" } });
    expect(sentEvent.payload).toMatchObject({ templateId: t.id, templateVersionNumber: 1, templateEdited: false });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { recordId: m.id, action: "CREATE" } });
    expect(audit.newValues).toMatchObject({ templateId: t.id, templateVersionNumber: 1 });
    // edited before sending → flagged, still linked
    fetchMock.mockImplementationOnce(() => ok(`wamid-tpl2-${run}`));
    const m2 = await messaging.sendConversationMessage(rep, conversationId, { body: `${preview.body} Thanks!`, templateId: t.id, templateVersionId: d.currentVersion!.id });
    expect(m2.template).toMatchObject({ edited: true });
    // change the template → message history unchanged, still version 1
    await svc.updateTemplate(rep, t.id, { version: d.version, body: "Totally new text {{contact.first_name}}" });
    const row = await prisma.crmMessage.findUniqueOrThrow({ where: { id: m.id } });
    expect(row).toMatchObject({ body: preview.body, templateId: t.id, templateVersionId: d.currentVersion!.id });
    // usage
    const after = await fresh(t.id);
    expect(after).toMatchObject({ usageCount: 2, currentVersionNumber: 2 });
    expect(after.usage[0]).toMatchObject({ key: "conversation_messages", count: 2, byVersion: { 1: 2 } });
    expect((await svc.listTemplateVersions(manager, t.id)).find((v) => v.versionNumber === 1)!.usageCount).toBe(2);
    expect((await list(rep, {}, `Status update ${run}`)).data[0].usageCount).toBe(2);
    // archived / wrong channel / mismatched version
    const email = await svc.createTemplate(rep, { name: `Email only ${run}`, channelType: "EMAIL", subject: "S", body: "B" });
    const e = await fresh(email.id);
    await svc.changeTemplateStatus(rep, email.id, "activate", { version: e.version });
    await expectCode(messaging.sendConversationMessage(rep, conversationId, { body: "B", templateId: email.id, templateVersionId: e.currentVersion!.id }), "VALIDATION_ERROR");
    await expectCode(messaging.sendConversationMessage(rep, conversationId, { body: "B", templateId: t.id, templateVersionId: e.currentVersion!.id }), "NOT_FOUND");
    await expect(messaging.sendConversationMessage(rep, conversationId, { body: "B", templateId: t.id })).rejects.toThrow();
    const a = await fresh(t.id);
    await svc.changeTemplateStatus(rep, t.id, "archive", { version: a.version });
    await expectCode(messaging.sendConversationMessage(rep, conversationId, { body: "x", templateId: t.id, templateVersionId: a.currentVersion!.id }), "INVALID_STATE_TRANSITION");
    // archived template keeps its history and messages
    expect((await prisma.crmMessage.findUniqueOrThrow({ where: { id: m.id } })).templateId).toBe(t.id);
    // the database refuses a template id on an inbound message, or one without its version
    await expect(prisma.crmMessage.update({ where: { id: m.id }, data: { templateVersionId: null } })).rejects.toThrow();
  });

  it("template history is readable through the shared timeline access check", async () => {
    const { assertCrmEntityAccess } = await import("../crm-entity-access");
    await expect(assertCrmEntityAccess(otherRep, "TEMPLATE", quote.id)).resolves.toBeUndefined();
    await expectCode(assertCrmEntityAccess(otherRep, "TEMPLATE", crypto.randomUUID()), "NOT_FOUND");
  });
});
