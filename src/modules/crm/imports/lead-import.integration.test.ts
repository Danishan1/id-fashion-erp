/**
 * Phase 03 — lead import & capture against a real, migrated Postgres.
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database (see
 * src/modules/crm/leads/lead.integration.test.ts). Mocked: crm.view_all
 * (granted to the "manager" user only) and the Redis enqueue — worker steps
 * are invoked directly, exactly as the worker would.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;
process.env.NEXTAUTH_SECRET ??= "integration-test-secret";

const viewAllUsers = new Set<string>();
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, _m: string, action: string) => (action === "view_all" ? viewAllUsers.has(userId) : true)),
    assert: vi.fn(async () => undefined),
    invalidate: vi.fn(),
  },
}));
const enqueued: { name: string; data: unknown }[] = [];
vi.mock("./crm-import.queue", () => ({
  CRM_INGEST_QUEUE_NAME: "test",
  enqueueCrmIngestJob: vi.fn(async (job: { name: string; data: unknown }) => {
    enqueued.push(job);
    return `job-${enqueued.length}`;
  }),
}));
vi.mock("@/lib/api-route", async () => {
  const { toErrorResponse } = await import("@/core/errors/BusinessRuleError");
  return {
    requireSession: vi.fn(async () => {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    }),
    handleApiError: (error: unknown) => {
      const { status, body } = toErrorResponse(error);
      return Response.json(body, { status });
    },
  };
});
vi.mock("@/core/file-storage/FileStorage", () => ({

  saveFile: vi.fn(async () => ({ storageKey: `tmp/${Math.random()}`, fileSizeBytes: 1 })),
  deleteStoredFile: vi.fn(async () => undefined),
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("CRM lead import & capture (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const imports = await import("./crm-import.service");
  const leads = await import("../leads/lead.service");
  const settings = await import("../settings/crm-settings.service");
  const keys = await import("../capture/crm-api-keys.service");
  const webhooks = await import("../capture/crm-webhooks.service");
  const events = await import("../capture/crm-ingest-events.service");
  const { signGenericWebhook } = await import("../capture/providers/generic-webhook.adapter");
  const { buildXlsxBuffer } = await import("@/lib/xlsx");
  const ingestRoute = await import("@/app/api/v1/crm/leads/ingest/route");
  const webhookRoute = await import("@/app/api/v1/crm/webhooks/leads/[provider]/[endpointId]/route");

  const run = `p3${Date.now().toString(36)}`;
  const base = String(Date.now()).slice(-7);
  const phone = (n: number) => `98${n}${base}`.slice(0, 10);
  const mail = (n: string) => `${n}.${run}@example.test`;
  let manager: Actor;
  let rep: Actor;
  let other: Actor;

  const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n"));
  const runToEnd = async (actor: Actor, id: string) => {
    await imports.startImport(actor, id);
    await imports.processImportJob(id);
    return imports.getImportJob(actor, id);
  };
  const rowsOf = async (actor: Actor, id: string) => (await imports.listImportRows(actor, id, { pageSize: 200 })).data;
  const setup = (actor: Actor, id: string, policy: "SKIP" | "UPDATE" | "CREATE" | "FLAG_FOR_REVIEW", extra: Record<string, unknown> = {}) =>
    imports.getImportJob(actor, id).then((j) => imports.updateImportSetup(actor, id, { mapping: j.mapping as Record<string, string>, sourceId: null, duplicatePolicy: policy, ...extra }));

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@crm-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [m, r, o] = await Promise.all([mk("manager"), mk("rep"), mk("other")]);
    manager = { companyId: company.id, userId: m.id, branchId: null };
    rep = { companyId: company.id, userId: r.id, branchId: null };
    other = { companyId: company.id, userId: o.id, branchId: null };
    viewAllUsers.add(m.id);
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

  it("uploads a CSV, suggests a mapping and stores every row without importing anything", async () => {
    const file = csv([
      ["Customer Name", "Company", "Mobile No", "Email ID", "Requirement", "City", "Shoe size"],
      ["ASHISH KUMAR", "Kumar Knits", `+91 ${phone(1)}`, ` ${mail("ashish").toUpperCase()} `, "5000 polo shirts", "Tiruppur", "9"],
    ]);
    const job = await imports.uploadImportFile(rep, { name: "first.csv", buffer: file });
    expect(job.status).toBe("PENDING");
    expect(job.totalRows).toBe(1);
    expect(job.mapping).toEqual({ "Customer Name": "fullName", Company: "companyName", "Mobile No": "mobile", "Email ID": "email", Requirement: "requirement", City: "city", "Shoe size": "" });
    expect(await prisma.crmLead.count({ where: { importJobId: job.id } })).toBe(0);
  });

  it("previews validation, in-file duplicates and existing-lead duplicates, then imports with SKIP", async () => {
    const existing = await leads.createLead(rep, { firstName: "Existing", email: mail("existing") });
    const file = csv([
      ["Name", "Company", "Mobile", "Email", "Notes"],
      ["Priya Shah", "Shah Exports", phone(2), mail("priya"), "Denim"],
      ["Bad Email", "X", "", "not-an-email", ""],
      ["No Contact", "Y", "", "", ""],
      ["Priya S", "Shah Exports", `0${phone(2)}`, "", "same phone as row 1"],
      ["Exists Again", "", "", mail("existing"), ""],
      ["  ", "Only Company Ltd", phone(3), "", ""],
    ]);
    const job = await imports.uploadImportFile(rep, { name: "skip.csv", buffer: file });
    const ready = await imports.validateImport(rep, job.id);
    expect(ready.status).toBe("READY");
    expect(ready.errorRows).toBe(2);
    const preview = await rowsOf(rep, job.id);
    expect(preview.map((r) => r.validation)).toEqual(["VALID", "ERROR", "ERROR", "WARNING", "WARNING", "WARNING"]);
    expect(preview[1].messages.some((m) => m.field === "email")).toBe(true);
    expect(preview[2].messages[0].message).toMatch(/Missing contact details/);
    expect(preview[3].inFileDuplicateOf).toBe(1);
    expect(preview[4].duplicates?.leads[0].leadNumber).toBe(existing.leadNumber);
    expect(preview[5].mapped?.firstName).toBe("Only Company Ltd");

    const done = await runToEnd(rep, job.id);
    expect(done.status).toBe("PARTIALLY_COMPLETED");
    const rows = await rowsOf(rep, job.id);
    expect(rows.map((r) => r.outcome)).toEqual(["IMPORTED", "FAILED", "FAILED", "SKIPPED", "SKIPPED", "IMPORTED"]);
    expect(rows[3].outcomeReason).toMatch(/Same person as row 1/);
    expect({ i: done.importedRows, s: done.skippedRows, f: done.failedRows, p: done.processedRows }).toEqual({ i: 2, s: 2, f: 2, p: 6 });
    const lead = await prisma.crmLead.findUniqueOrThrow({ where: { id: rows[0].lead!.id }, include: { source: true } });
    expect(lead).toMatchObject({ captureChannel: "CSV", captureProvider: "import", importJobId: job.id, email: mail("priya"), mobile: phone(2) });
    expect(lead.source?.key).toBe("import");
    const created = await prisma.crmEvent.findFirstOrThrow({ where: { entityId: lead.id, eventType: "lead.created" } });
    expect(created.payload).toMatchObject({ channel: "CSV", importJobId: job.id });
  });

  it("UPDATE fills only empty fields, keeps source attribution and saves a new requirement as a note", async () => {
    const lead = await leads.createLead(rep, { firstName: "Meena", email: mail("meena"), requirement: "Kurtis", utmSource: "google" });
    const file = csv([
      ["Name", "Email", "City", "Requirement", "UTM source", "Mobile"],
      ["MEENA CHANGED", mail("meena"), "Jaipur", "Now also dupattas", "facebook", phone(4)],
    ]);
    const job = await imports.uploadImportFile(rep, { name: "update.csv", buffer: file });
    await setup(rep, job.id, "UPDATE");
    await imports.validateImport(rep, job.id);
    const done = await runToEnd(rep, job.id);
    expect(done.updatedRows).toBe(1);
    const after = await prisma.crmLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ firstName: "Meena", city: "Jaipur", mobile: phone(4), requirement: "Kurtis", utmSource: "google", captureChannel: "MANUAL", sourceId: lead.sourceId });
    const note = await prisma.crmNote.findFirstOrThrow({ where: { entityId: lead.id } });
    expect(note.body).toMatch(/Now also dupattas/);
  });

  it("CREATE makes a new lead despite a warning duplicate, but respects BLOCK rules", async () => {
    await leads.createLead(rep, { firstName: "Dup", email: mail("dupc") });
    const make = async (name: string) => {
      const job = await imports.uploadImportFile(rep, { name, buffer: csv([["Name", "Email"], ["Dup Again", mail("dupc")]]) });
      await setup(rep, job.id, "CREATE");
      await imports.validateImport(rep, job.id);
      return runToEnd(rep, job.id);
    };
    expect((await make("create.csv")).importedRows).toBe(1);
    await settings.updateLeadDuplicateRules(manager, { rules: [{ rule: "EMAIL", action: "BLOCK" }] });
    try {
      const blocked = await make("blocked.csv");
      expect(blocked.skippedRows).toBe(1);
      expect((await rowsOf(rep, blocked.id))[0].outcomeReason).toMatch(/block/i);
    } finally {
      await settings.updateLeadDuplicateRules(manager, { rules: [{ rule: "EMAIL", action: "WARN" }] });
    }
  });

  it("FLAG_FOR_REVIEW holds duplicates for a decision: update, create or skip", async () => {
    const a = await leads.createLead(rep, { firstName: "Flag A", email: mail("flaga") });
    await leads.createLead(rep, { firstName: "Flag B", email: mail("flagb") });
    await leads.createLead(rep, { firstName: "Flag C", email: mail("flagc") });
    const job = await imports.uploadImportFile(rep, {
      name: "flag.csv",
      buffer: csv([["Name", "Email", "City"], ["Flag A", mail("flaga"), "Surat"], ["Flag B", mail("flagb"), ""], ["Flag C", mail("flagc"), ""], ["Fresh", mail("fresh"), ""]]),
    });
    await setup(rep, job.id, "FLAG_FOR_REVIEW");
    await imports.validateImport(rep, job.id);
    const done = await runToEnd(rep, job.id);
    expect({ flagged: done.flaggedRows, imported: done.importedRows, status: done.status }).toEqual({ flagged: 3, imported: 1, status: "COMPLETED" });
    const rows = await rowsOf(rep, job.id);
    await imports.reviewImportRows(rep, job.id, { action: "UPDATE", rowIds: [rows[0].id] });
    await imports.reviewImportRows(rep, job.id, { action: "CREATE", rowIds: [rows[1].id] });
    const { job: after } = await imports.reviewImportRows(rep, job.id, { action: "SKIP", rowIds: [rows[2].id] });
    expect({ f: after.flaggedRows, u: after.updatedRows, i: after.importedRows, s: after.skippedRows }).toEqual({ f: 0, u: 1, i: 2, s: 1 });
    expect((await prisma.crmLead.findUniqueOrThrow({ where: { id: a.id } })).city).toBe("Surat");
  });

  it("imports XLSX, links a matching contact, and recognises a re-imported external id", async () => {
    const contactEmail = mail("contact");
    const contact = await prisma.crmContact.create({ data: { companyId: rep.companyId, firstName: "Known", fullName: "Known Contact", email: contactEmail, emailKeys: [contactEmail], createdByUserId: rep.userId } });
    const xlsx = await buildXlsxBuffer("Leads", [{ header: "Enquiry ID", key: "id" }, { header: "Name", key: "n" }, { header: "Email", key: "e" }, { header: "Tags", key: "t" }], [
      { id: `EX-${run}`, n: "Excel Person", e: mail("excel"), t: "fair, vip" },
      { id: `EX2-${run}`, n: "Known Again", e: contactEmail, t: "" },
    ]);
    const job = await imports.uploadImportFile(rep, { name: "leads.xlsx", buffer: xlsx });
    expect(job.fileType).toBe("XLSX");
    expect(job.mapping).toMatchObject({ "Enquiry ID": "externalId", Name: "fullName", Email: "email", Tags: "tags" });
    await setup(rep, job.id, "UPDATE");
    await imports.validateImport(rep, job.id);
    const done = await runToEnd(rep, job.id);
    expect(done.importedRows).toBe(2);
    const rows = await rowsOf(rep, job.id);
    const linked = await prisma.crmLead.findUniqueOrThrow({ where: { id: rows[1].lead!.id } });
    expect(linked.crmContactId).toBe(contact.id);
    expect(linked.captureChannel).toBe("XLSX");

    const again = await imports.uploadImportFile(rep, { name: "again.xlsx", buffer: xlsx });
    await imports.validateImport(rep, again.id);
    const preview = await rowsOf(rep, again.id);
    expect(preview[0].duplicates?.external?.leadNumber).toBe(rows[0].lead!.leadNumber);
    const doneAgain = await runToEnd(rep, again.id);
    expect(doneAgain.importedRows).toBe(0);
    expect((await rowsOf(rep, again.id))[0].outcomeReason).toMatch(/Already received/);
  });

  it("rejects empty, header-only, headerless, legacy and binary files with clear messages", async () => {
    const up = (name: string, buffer: Buffer) => imports.uploadImportFile(rep, { name, buffer });
    await expect(up("e.csv", Buffer.alloc(0))).rejects.toThrow(/empty/);
    await expect(up("h.csv", Buffer.from("Name,Email\n"))).rejects.toThrow(/no data rows/);
    await expect(up("d.csv", Buffer.from(`${mail("x")},${phone(5)}\nfoo@bar.com,9999999999\n`))).rejects.toThrow(/looks like data/);
    await expect(up("old.xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).rejects.toThrow(/\.xls/);
    await expect(up("bin.csv", Buffer.from([0x4d, 0x5a, 0x00, 0x01, 0x02]))).rejects.toThrow(/binary/);
    await expect(up("fake.xlsx", Buffer.from("not a zip"))).rejects.toThrow(/damaged/);
    await expect(up("x.pdf", Buffer.from("%PDF-1.4"))).rejects.toThrow(/\.csv or \.xlsx/);
  });

  it("decodes Windows-1252 and semicolon-separated files", async () => {
    const text = `Name;Email;City\r\nJosé Müller;${mail("jose")};Zürich\r\n`;
    const job = await imports.uploadImportFile(rep, { name: "latin.csv", buffer: Buffer.from(text, "latin1") });
    await imports.validateImport(rep, job.id);
    const [row] = await rowsOf(rep, job.id);
    expect(row.raw.City).toBe("Zürich");
    expect(row.mapped).toMatchObject({ firstName: "José", lastName: "Müller" });
  });

  it("cancels before start and mid-run; every row still ends with an outcome", async () => {
    const make = async (n: number) => {
      const rows = [["Name", "Email"], ...Array.from({ length: n }, (_, i) => [`Cancel ${i}`, mail(`cancel${i}-${n}`)])];
      return imports.uploadImportFile(rep, { name: `cancel${n}.csv`, buffer: csv(rows) });
    };
    const early = await make(3);
    const cancelled = await imports.cancelImport(rep, early.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect((await rowsOf(rep, early.id)).every((r) => r.outcome === "SKIPPED")).toBe(true);

    const mid = await make(150);
    await imports.validateImport(rep, mid.id);
    await imports.startImport(rep, mid.id);
    await prisma.crmImportJob.update({ where: { id: mid.id }, data: { cancelRequestedAt: new Date() } });
    await imports.processImportJob(mid.id);
    const after = await imports.getImportJob(rep, mid.id);
    expect(after.status).toBe("CANCELLED");
    expect(after.processedRows).toBe(150);
    expect(await prisma.crmImportRow.count({ where: { jobId: mid.id, outcome: "PENDING" } })).toBe(0);
  });

  it("builds an error file with reasons, duplicate info and formula-safe cells", async () => {
    const job = await imports.uploadImportFile(rep, { name: "err.csv", buffer: csv([["Name", "Email"], ["=HYPERLINK(\"x\")", "bad"], ["Ok", mail("errok")]]) });
    await imports.validateImport(rep, job.id);
    await runToEnd(rep, job.id);
    const file = await imports.buildImportErrorFile(rep, job.id, "csv");
    const text = file.body.toString("utf-8");
    expect(text).toContain("Import Status,Error Reason");
    expect(text).toContain("'=HYPERLINK");
    expect(text).toContain("FAILED");
    expect(text).not.toContain(mail("errok"));
    const xlsx = await imports.buildImportErrorFile(rep, job.id, "xlsx", "all");
    expect(xlsx.body.subarray(0, 2).toString()).toBe("PK");
  });

  it("keeps import history private to the importer unless they have crm.view_all", async () => {
    const job = await imports.uploadImportFile(rep, { name: "private.csv", buffer: csv([["Name", "Email"], ["P", mail("private")]]) });
    await expect(imports.getImportJob(other, job.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await imports.listImportJobs(other, { skip: 0, take: 100 })).data.map((j) => j.id)).not.toContain(job.id);
    expect((await imports.getImportJob(manager, job.id)).id).toBe(job.id);
  });

  it("API: key auth, idempotent replays, external lead ids and validation errors", async () => {
    const created = await keys.createApiKey(manager, { name: `Website ${run}`, duplicatePolicy: "SKIP" });
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      ingestRoute.POST(new NextRequest("http://x/api/v1/crm/leads/ingest", { method: "POST", body: JSON.stringify(body), headers: { authorization: `Bearer ${created.key}`, "content-type": "application/json", ...headers } }));

    const first = await post({ name: "Web Person", mobile_no: phone(6), Email: mail("web"), message: "Need samples", channel: "WEBSITE_FORM", utm_source: "google", favourite: "x" }, { "idempotency-key": `idem-${run}` });
    expect(first.status).toBe(201);
    const body = (await first.json()).data;
    expect(body).toMatchObject({ outcome: "IMPORTED", replayed: false, unmappedFields: ["favourite"] });
    const lead = await prisma.crmLead.findUniqueOrThrow({ where: { id: body.leadId }, include: { source: true } });
    expect(lead).toMatchObject({ captureChannel: "WEBSITE_FORM", captureProvider: "api", utmSource: "google", requirement: "Need samples", ownerUserId: null });
    expect(lead.source?.key).toBe("website");

    const replay = await post({ name: "Different" }, { "idempotency-key": `idem-${run}` });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect((await replay.json()).data.leadId).toBe(body.leadId);

    const ext1 = await post({ name: "Ext", email: mail("ext"), externalLeadId: `L-${run}` });
    const ext2 = await post({ name: "Ext", email: mail("ext2"), externalLeadId: `L-${run}` });
    expect(ext1.status).toBe(201);
    expect((await ext2.json()).data).toMatchObject({ outcome: "SKIPPED" });

    const invalid = await post({ name: "No contact" });
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).data.outcome).toBe("FAILED");

    const bad = await ingestRoute.POST(new NextRequest("http://x/api/v1/crm/leads/ingest", { method: "POST", body: "{}", headers: { authorization: "Bearer crmk_000000000000_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }));
    expect(bad.status).toBe(401);
    await keys.revokeApiKey(manager, created.id);
    expect((await post({ name: "After revoke", email: mail("rev") })).status).toBe(401);
  });

  it("webhook: rejects bad signatures, ingests signed deliveries and ignores repeats", async () => {
    const hook = await webhooks.createWebhook(manager, { name: `Zapier ${run}`, fieldMapping: { fullName: "contact.name", email: "contact.email", requirement: "message", externalId: "id" }, duplicatePolicy: "SKIP" });
    const deliver = (payload: unknown, opts: { secret?: string; ts?: number; eventId?: string } = {}) => {
      const raw = JSON.stringify(payload);
      const ts = opts.ts ?? Math.floor(Date.now() / 1000);
      return webhookRoute.POST(
        new NextRequest(`http://x${hook.path}`, {
          method: "POST",
          body: raw,
          headers: { "content-type": "application/json", "x-crm-timestamp": String(ts), "x-crm-signature": signGenericWebhook(opts.secret ?? hook.secret, ts, raw), ...(opts.eventId ? { "x-crm-event-id": opts.eventId } : {}) },
        }),
        { params: Promise.resolve({ provider: "generic", endpointId: hook.id }) }
      );
    };
    const payload = { id: `W-${run}`, contact: { name: "Hook Person", email: mail("hook") }, message: "Bulk tees" };
    expect((await deliver(payload, { secret: "whsec_wrong" })).status).toBe(401);
    expect((await deliver(payload, { ts: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);

    const ok = await deliver(payload, { eventId: `evt-${run}` });
    expect(ok.status).toBe(200);
    const [result] = (await ok.json()).data.results;
    expect(result).toMatchObject({ outcome: "IMPORTED", replayed: false });
    const again = await deliver(payload, { eventId: `evt-${run}` });
    expect((await again.json()).data.results[0]).toMatchObject({ replayed: true, leadNumber: result.leadNumber });
    const sameLeadNewEvent = await deliver(payload, { eventId: `evt2-${run}` });
    expect((await sameLeadNewEvent.json()).data.results[0].outcome).toBe("SKIPPED");
    expect(await prisma.crmLead.count({ where: { email: mail("hook") } })).toBe(1);

    const rotated = await webhooks.rotateWebhookSecret(manager, hook.id);
    expect((await deliver(payload)).status).toBe(401);
    expect(rotated.secret).not.toBe(hook.secret);
    const unknown = await webhookRoute.POST(new NextRequest("http://x/x", { method: "POST", body: "{}" }), { params: Promise.resolve({ provider: "facebook", endpointId: hook.id }) });
    expect(unknown.status).toBe(404);
  });

  it("flagged API submissions can be reviewed; the log redacts secrets", async () => {
    const lead = await leads.createLead(rep, { firstName: "Review", email: mail("review") });
    const key = await keys.createApiKey(manager, { name: `Flag ${run}`, duplicatePolicy: "FLAG_FOR_REVIEW" });
    const res = await ingestRoute.POST(
      new NextRequest("http://x/api/v1/crm/leads/ingest", { method: "POST", body: JSON.stringify({ name: "Review", email: mail("review"), city: "Pune", password: "hunter2" }), headers: { "x-api-key": key.key } })
    );
    expect(res.status).toBe(202);
    const { submissionId } = (await res.json()).data;
    const ev = await events.getIngestEvent(manager, submissionId);
    expect(JSON.stringify(ev.received)).not.toContain("hunter2");
    const reviewed = await events.reviewIngestEvent(manager, submissionId, { action: "UPDATE" });
    expect(reviewed.outcome).toBe("UPDATED");
    expect((await prisma.crmLead.findUniqueOrThrow({ where: { id: lead.id } })).city).toBe("Pune");
  });

  it("keeps the preview when only the duplicate policy changes, and rebuilds it when the mapping changes", async () => {
    const job = await imports.uploadImportFile(rep, { name: "policy.csv", buffer: csv([["Name", "Email", "City"], ["Pol", mail("pol"), "Agra"]]) });
    await imports.validateImport(rep, job.id);
    const j = await imports.getImportJob(rep, job.id);
    const kept = await imports.updateImportSetup(rep, job.id, { mapping: j.mapping as Record<string, string>, sourceId: null, duplicatePolicy: "FLAG_FOR_REVIEW" });
    expect(kept.status).toBe("READY");
    expect(kept.validRows + kept.warningRows).toBe(1);
    const reset = await imports.updateImportSetup(rep, job.id, { mapping: { ...(j.mapping as Record<string, string>), City: "" }, sourceId: null, duplicatePolicy: "FLAG_FOR_REVIEW" });
    expect(reset.status).toBe("PENDING");
    expect((await rowsOf(rep, job.id))[0].validation).toBe("PENDING");
  });

  it("numbers leads per company, whatever branch the creator works in", async () => {
    const branch = await prisma.branch.findFirstOrThrow({ where: { companyId: rep.companyId } });
    const a = await leads.createLead({ ...rep, branchId: branch.id }, { firstName: "Branch", email: mail("branch") });
    const b = await leads.createLead({ ...rep, branchId: null }, { firstName: "No branch", email: mail("nobranch") });
    expect(a.leadNumber).not.toBe(b.leadNumber);
    expect(await prisma.documentSequence.count({ where: { companyId: rep.companyId, documentType: "CRM_LEAD", branchId: { not: null } } })).toBe(0);
  });

  it("re-processes a failed submission when the sender delivers it again", async () => {
    const key = await keys.createApiKey(manager, { name: `Retry ${run}`, duplicatePolicy: "SKIP" });
    const send = () =>
      ingestRoute.POST(new NextRequest("http://x/api/v1/crm/leads/ingest", { method: "POST", body: JSON.stringify({ name: "Retry Me", email: mail("retry") }), headers: { "x-api-key": key.key, "idempotency-key": `retry-${run}` } }));
    const first = (await (await send()).json()).data;
    // Simulate an infrastructure failure on the first attempt.
    await prisma.crmIngestEvent.update({ where: { id: first.submissionId }, data: { status: "FAILED", outcome: "FAILED", leadId: null, attempts: 1 } });
    await prisma.crmLead.delete({ where: { id: first.leadId } });
    const again = await send();
    const body = (await again.json()).data;
    expect(again.headers.get("Idempotent-Replayed")).toBe("true");
    expect(body.outcome).toBe("IMPORTED");
    expect((await prisma.crmIngestEvent.findUniqueOrThrow({ where: { id: first.submissionId } })).attempts).toBe(2);
  });

  it("manual leads still go through the lead service with warn-and-confirm", async () => {
    const { captureManualLead } = await import("../ingestion/lead-ingest.service");
    const a = await captureManualLead(rep, { firstName: "Manual", email: mail("manual") });
    expect(a.captureChannel).toBe("MANUAL");
    await expect(captureManualLead(rep, { firstName: "Manual 2", email: mail("manual") })).rejects.toMatchObject({ code: "CRM_POSSIBLE_DUPLICATE" });
  });
});
