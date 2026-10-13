/**
 * Phase 14 — Bulk Action Engine against a real, migrated Postgres database:
 * registry security, selection snapshots (ids / filter), per-record execution
 * through the real CRM services, partial success, skip reasons, retry,
 * idempotent submit, cancellation, crash recovery + lease, export with
 * formula-injection protection, secure download, error report, job
 * visibility, re-validation at start, workflow enrolment, messaging guard.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database:
 *   CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/bulk-actions/bulk-actions.integration.test.ts
 *
 * Only permissions are mocked (all granted, except what a test denies; view_all per user).
 * The queue is not used: tests call the processor directly, like the worker does.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;
process.env.AUTH_SECRET ??= "crm-it-bulk-secret";
process.env.FILE_STORAGE_ROOT = mkdtempSync(path.join(tmpdir(), "bulk-it-"));
// Never touch a real queue from tests.
delete process.env.REDIS_URL;

const viewAllUsers = new Set<string>();
const denied = new Set<string>(); // `${userId}:${module}.${action}`
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, module: string, action: string) => {
      if (denied.has(`${userId}:${module}.${action}`)) return false;
      return action === "view_all" ? viewAllUsers.has(userId) : true;
    }),
    assert: vi.fn(async (userId: string, module: string, action: string) => {
      if (denied.has(`${userId}:${module}.${action}`)) {
        const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
        throw new BusinessRuleError("PERMISSION_DENIED", "denied");
      }
    }),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("Bulk action engine (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const svc = await import("./bulk-jobs.service");
  const engine = await import("./bulk-engine");
  const registry = await import("./bulk-registry");
  const leads = await import("@/modules/crm/leads/lead.service");
  const opps = await import("@/modules/crm/opportunities/crm-opportunities.service");
  const settings = await import("@/modules/crm/settings/crm-settings.service");
  const wf = await import("@/modules/crm/workflows/crm-workflows.service");

  const run = `bk${Date.now().toString(36)}`;
  let admin: Actor; // view_all
  let rep: Actor; // own records only, not a CRM admin for job visibility tests
  let owner2: string;
  const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });
  const lead = async (firstName: string, by: Actor = admin, extra: Record<string, unknown> = {}) =>
    (await leads.createLead(by, { firstName, lastName: run, email: `${firstName.toLowerCase().replace(/[^a-z0-9]/g, "")}.${Math.random().toString(36).slice(2, 7)}.${run}@bulk-it.local`, ...extra })) as { id: string; version: number };
  const submit = (actor: Actor, body: Record<string, unknown>) => svc.createBulkJob(actor, body);
  const items = (jobId: string) => prisma.bulkJobItem.findMany({ where: { jobId }, orderBy: { sequence: "asc" } });
  const job = (id: string) => prisma.bulkJob.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@bulk-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [a, r, o2] = await Promise.all([mk("Asha Admin"), mk("Ravi Rep"), mk("Omar Owner")]);
    admin = { companyId: company.id, userId: a.id, branchId: null };
    rep = { companyId: company.id, userId: r.id, branchId: null };
    owner2 = o2.id;
    viewAllUsers.add(a.id);
    // Rep is not a CRM admin (no crm_settings.edit): sees only own bulk jobs.
    denied.add(`${r.id}:crm_settings.edit`);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("registry: only registered actions of the right entity, strict params, unavailable actions explain why", async () => {
    const caps = await svc.getBulkCapabilities(admin, "LEAD");
    const keys = caps.actions.map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining(["lead.assign", "lead.add_tags", "lead.remove_tags", "lead.archive", "lead.restore", "lead.change_status", "lead.update_fields", "lead.export", "lead.enroll_workflow", "lead.send_template"]));
    const del = caps.actions.find((a) => a.key === "lead.delete")!;
    expect(del.available).toBe(false);
    expect(del.unavailableReason).toMatch(/archive/i);
    expect(caps.actions.find((a) => a.key === "lead.enroll_sequence")!.unavailableReason).toMatch(/sequence/i);
    expect(caps.actions.find((a) => a.key === "lead.assign")!.fields[0].type).toBe("user");

    const l = await lead("Reg");
    const sel = { mode: "IDS", ids: [l.id] };
    await expectCode(submit(admin, { entityType: "LEAD", actionKey: "contact.assign", selection: sel, params: {} }), "VALIDATION_ERROR");
    await expectCode(submit(admin, { entityType: "LEAD", actionKey: "prisma.crmLead.deleteMany", selection: sel, params: {} }), "VALIDATION_ERROR");
    await expectCode(submit(admin, { entityType: "CrmLead", actionKey: "lead.assign", selection: sel, params: {} }), "VALIDATION_ERROR");
    // Field allowlist: unknown fields are rejected, not ignored.
    await expectCode(submit(admin, { entityType: "LEAD", actionKey: "lead.update_fields", selection: sel, params: { score: 50, companyId: "x" } }), "VALIDATION_ERROR");
    await expectCode(submit(admin, { entityType: "LEAD", actionKey: "lead.delete", selection: sel, params: {} }), "VALIDATION_ERROR");
    // Permission from the registry definition (crm.export).
    denied.add(`${rep.userId}:crm.export`);
    await expectCode(submit(rep, { entityType: "LEAD", actionKey: "lead.export", selection: sel, params: { format: "CSV" } }), "PERMISSION_DENIED");
    denied.delete(`${rep.userId}:crm.export`);
    // Registry rejects bad registrations.
    expect(() => registry.registerAction({ key: "lead.assign", entityType: "LEAD" } as never)).toThrow();
  });

  it("assigns selected leads through the lead service: skips with reasons, leaves out records the user can't see, audits and emits events", async () => {
    const [a, b, c, archived] = await Promise.all([lead("Assign A"), lead("Assign B"), lead("Assign C"), lead("Assign Archived")]);
    await leads.archiveLead(admin, archived.id);
    await leads.assignLead(admin, c.id, { ownerUserId: owner2 });
    const hidden = await lead("Hidden", admin); // created by admin, unowned → not visible to rep
    const mine = await lead("Rep own", rep);

    // Rep selects one of their own and one they can't see.
    const r = await submit(rep, { entityType: "LEAD", actionKey: "lead.assign", selection: { mode: "IDS", ids: [mine.id, hidden.id] }, params: { ownerUserId: rep.userId } });
    expect(r.totalCount).toBe(1);
    expect(r.warnings?.join(" ")).toMatch(/not visible/i);

    const preview = await svc.previewBulkJob(admin, { entityType: "LEAD", actionKey: "lead.assign", selection: { mode: "IDS", ids: [a.id, b.id, c.id, archived.id, a.id] }, params: { ownerUserId: owner2 } });
    expect(preview.count).toBe(4); // duplicates removed
    expect(preview.summary).toContain("Omar Owner");

    const created = await submit(admin, { entityType: "LEAD", actionKey: "lead.assign", selection: { mode: "IDS", ids: [a.id, b.id, c.id, archived.id] }, params: { ownerUserId: owner2 } });
    expect(created.status).toBe("QUEUED");
    expect(created.queued).toBe(false); // no Redis in tests: stays QUEUED for the worker / recovery
    expect(await engine.processBulkJob(created.id)).toBe("COMPLETED");
    const j = await job(created.id);
    expect([j.succeededCount, j.skippedCount, j.failedCount, j.processedCount]).toEqual([2, 2, 0, 4]);
    const its = await items(created.id);
    expect(its.find((i) => i.entityId === c.id)!.message).toMatch(/already assigned/i);
    expect(its.find((i) => i.entityId === archived.id)!.message).toMatch(/archived/i);
    const leadA = await prisma.crmLead.findUniqueOrThrow({ where: { id: a.id } });
    expect(leadA.ownerUserId).toBe(owner2);
    expect(leadA.updatedByUserId).toBe(admin.userId);
    const events = await prisma.crmEvent.findMany({ where: { entityId: { in: [a.id, b.id] }, eventType: "lead.owner_changed" } });
    expect(events).toHaveLength(2);
    const audits = await prisma.auditLog.count({ where: { tableName: "bulk_jobs", recordId: created.id } });
    expect(audits).toBeGreaterThanOrEqual(2); // created + finished
    // Requester notified.
    expect(await prisma.notification.count({ where: { userId: admin.userId, title: { contains: "Assign owner" } } })).toBeGreaterThan(0);
    // A finished job can't be processed again.
    expect(await engine.processBulkJob(created.id)).toBeNull();
  });

  it("'all matching the filter' is a snapshot taken at submit; caps are enforced", async () => {
    const tag = `${run}-flt`;
    for (let i = 0; i < 3; i++) await lead(`Filter ${i}`, admin, { companyName: tag });
    const q = `search=${encodeURIComponent(tag)}&page=3&sortBy=fullName`;
    const preview = await svc.previewBulkJob(admin, { entityType: "LEAD", actionKey: "lead.add_tags", selection: { mode: "FILTER", filterQuery: q }, params: { tagNames: [`${run}-t1`] } });
    expect(preview.count).toBe(3);
    const created = await submit(admin, { entityType: "LEAD", actionKey: "lead.add_tags", selection: { mode: "FILTER", filterQuery: q }, params: { tagNames: [`${run}-t1`] } });
    await lead("Filter late", admin, { companyName: tag }); // after submit: not in the job
    expect(await engine.processBulkJob(created.id)).toBe("COMPLETED");
    expect((await job(created.id)).succeededCount).toBe(3);
    const tagged = await prisma.crmEntityTag.count({ where: { tag: { name: `${run}-t1` } } });
    expect(tagged).toBe(3);
    // Invalid filter values are refused.
    await expectCode(svc.previewBulkJob(admin, { entityType: "LEAD", actionKey: "lead.add_tags", selection: { mode: "FILTER", filterQuery: "temperatures=BOILING" }, params: { tagNames: ["x"] } }), "VALIDATION_ERROR");
  });

  it("partial failure → COMPLETED_WITH_ERRORS with safe reasons; retry runs only the failed records as a new linked job (once)", async () => {
    const o1 = (await opps.createOpportunity(admin, { name: `Open ${run}` })) as { id: string };
    const o2 = (await opps.createOpportunity(admin, { name: `Won ${run}` })) as { id: string };
    await opps.changeOpportunityStatus(admin, o2.id, { status: "WON", reason: "test" });
    const created = await submit(admin, { entityType: "OPPORTUNITY", actionKey: "opportunity.update_fields", selection: { mode: "IDS", ids: [o1.id, o2.id] }, params: { probability: 70 } });
    expect(await engine.processBulkJob(created.id)).toBe("COMPLETED_WITH_ERRORS");
    const failed = (await items(created.id)).find((i) => i.status === "FAILED")!;
    expect(failed.entityId).toBe(o2.id);
    expect(failed.errorCode).toBe("INVALID_STATE_TRANSITION");
    expect(failed.message).not.toMatch(/prisma|stack|at \//i);
    expect((await prisma.crmOpportunity.findUniqueOrThrow({ where: { id: o1.id } })).probability).toBe(70);

    const report = await svc.buildBulkErrorReport(admin, created.id);
    const csv = report.buffer.toString("utf8");
    expect(csv).toContain("Won ");
    expect(csv).toContain("INVALID_STATE_TRANSITION");

    await opps.changeOpportunityStatus(admin, o2.id, { status: "OPEN" });
    const retry = await svc.retryBulkJob(admin, created.id, {});
    expect(retry.totalCount).toBe(1);
    expect(retry.retryOfJobId).toBe(created.id);
    expect(await engine.processBulkJob(retry.id)).toBe("COMPLETED");
    expect((await prisma.crmOpportunity.findUniqueOrThrow({ where: { id: o2.id } })).probability).toBe(70);
    // Retrying again returns the existing retry instead of a second job.
    const again = await svc.retryBulkJob(admin, created.id, {});
    expect(again.id).toBe(retry.id);
    expect(again.duplicate).toBe(true);
    // Root idempotency key is inherited.
    expect((await job(retry.id)).selection).toMatchObject({ rootJobId: created.id });
  });

  it("submitting the same request twice (same idempotency key) creates one job", async () => {
    const l = await lead("Idem");
    const body = { entityType: "LEAD", actionKey: "lead.add_tags", selection: { mode: "IDS", ids: [l.id] }, params: { tagNames: [`${run}-idem`] }, idempotencyKey: `idem-${run}` };
    const [x, y] = await Promise.all([submit(admin, body), submit(admin, body)]);
    expect(x.id).toBe(y.id);
    expect(await prisma.bulkJob.count({ where: { idempotencyKey: `idem-${run}` } })).toBe(1);
  });

  it("archive needs the typed count; cancel stops remaining records (nothing rolled back); a queued job cancels at once", async () => {
    const ls = [];
    for (let i = 0; i < 7; i++) ls.push(await lead(`Cancel ${i}`));
    const sel = { mode: "IDS", ids: ls.map((l) => l.id) };
    await expectCode(submit(admin, { entityType: "LEAD", actionKey: "lead.archive", selection: sel, params: {} }), "VALIDATION_ERROR");
    const created = await submit(admin, { entityType: "LEAD", actionKey: "lead.archive", selection: sel, params: {}, confirmCount: 7 });
    const status = await engine.processBulkJob(created.id, {
      batchSize: 3,
      afterBatch: async (n) => {
        if (n === 3) await svc.cancelBulkJob(admin, created.id);
      },
    });
    expect(status).toBe("CANCELLED");
    const its = await items(created.id);
    expect(its.filter((i) => i.status === "SUCCEEDED")).toHaveLength(3);
    expect(its.filter((i) => i.status === "CANCELLED")).toHaveLength(4);
    expect(await prisma.crmLead.count({ where: { id: { in: ls.map((l) => l.id) }, archivedAt: { not: null } } })).toBe(3);
    await expectCode(svc.cancelBulkJob(admin, created.id), "INVALID_STATE_TRANSITION");

    const queued = await submit(admin, { entityType: "LEAD", actionKey: "lead.restore", selection: { mode: "IDS", ids: ls.slice(0, 3).map((l) => l.id) }, params: {} });
    const c = await svc.cancelBulkJob(admin, queued.id);
    expect(c.status).toBe("CANCELLED");
    expect(c.itemCounts.CANCELLED).toBe(3);
    expect(await engine.processBulkJob(queued.id)).toBeNull();
  });

  it("recovers after a crash: resumes a job with an expired lease, re-runs safe items, never runs one job twice at once", async () => {
    const ls = [await lead("Crash A"), await lead("Crash B")];
    const created = await submit(admin, { entityType: "LEAD", actionKey: "lead.update_fields", selection: { mode: "IDS", ids: ls.map((l) => l.id) }, params: { temperature: "HOT", score: 77 } });
    // Simulate a worker that died mid-record 10 minutes ago.
    const old = new Date(Date.now() - 10 * 60_000);
    await prisma.bulkJob.update({ where: { id: created.id }, data: { status: "RUNNING", lockedAt: old, lockToken: "00000000-0000-4000-8000-000000000001", startedAt: old } });
    await prisma.bulkJobItem.updateMany({ where: { jobId: created.id, sequence: 1 }, data: { status: "PROCESSING", attempts: 1 } });
    // A live lease blocks a second processor.
    await prisma.bulkJob.update({ where: { id: created.id }, data: { lockedAt: new Date() } });
    expect(await engine.processBulkJob(created.id)).toBeNull();
    await prisma.bulkJob.update({ where: { id: created.id }, data: { lockedAt: old } });
    const recovered = await engine.recoverBulkJobs(new Date());
    expect(recovered.resumed).toContain(created.id);
    const j = await job(created.id);
    expect(j.status).toBe("COMPLETED");
    expect(j.runCount).toBeGreaterThanOrEqual(1);
    const its = await items(created.id);
    expect(its.every((i) => i.status === "SUCCEEDED")).toBe(true);
    expect(its[0].attempts).toBe(2);
    const l = await prisma.crmLead.findUniqueOrThrow({ where: { id: ls[0].id } });
    expect([l.temperature, l.score]).toEqual(["HOT", 77]);

    // Two processors racing on a fresh job: exactly one wins.
    const fresh = await submit(admin, { entityType: "LEAD", actionKey: "lead.add_tags", selection: { mode: "IDS", ids: ls.map((x) => x.id) }, params: { tagNames: [`${run}-race`] } });
    const results = await Promise.all([engine.processBulkJob(fresh.id), engine.processBulkJob(fresh.id)]);
    expect(results.filter((r) => r === "COMPLETED")).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(1);
  });

  it("re-validates at start: an inactive requester or an owner deactivated after submit fails the job without touching records", async () => {
    const l = await lead("Reval");
    const tmp = await prisma.user.create({ data: { companyId: admin.companyId, email: `tmp.${run}@bulk-it.local`, passwordHash: "x", fullName: `Temp ${run}` } });
    const created = await submit(admin, { entityType: "LEAD", actionKey: "lead.assign", selection: { mode: "IDS", ids: [l.id] }, params: { ownerUserId: tmp.id } });
    await prisma.user.update({ where: { id: tmp.id }, data: { status: "SUSPENDED" } });
    expect(await engine.processBulkJob(created.id)).toBe("FAILED");
    const j = await job(created.id);
    expect(j.errorMessage).toMatch(/no longer valid/i);
    expect((await items(created.id))[0].status).toBe("CANCELLED");
    expect((await prisma.crmLead.findUniqueOrThrow({ where: { id: l.id } })).ownerUserId).not.toBe(tmp.id);

    const leaver = await prisma.user.create({ data: { companyId: admin.companyId, email: `leaver.${run}@bulk-it.local`, passwordHash: "x", fullName: `Leaver ${run}` } });
    const lv = { companyId: admin.companyId, userId: leaver.id, branchId: null };
    viewAllUsers.add(leaver.id);
    const lj = await submit(lv, { entityType: "LEAD", actionKey: "lead.add_tags", selection: { mode: "IDS", ids: [l.id] }, params: { tagNames: ["x"] } });
    await prisma.user.update({ where: { id: leaver.id }, data: { status: "SUSPENDED" } });
    expect(await engine.processBulkJob(lj.id)).toBe("FAILED");
    expect((await job(lj.id)).errorCode).toBe("REQUESTER_INACTIVE");
  });

  it("exports as CSV/XLSX with formula-injection protection; only the requester can download; expired files are purged", async () => {
    const evil = await lead("=HYPERLINK(\"http://x\")", admin, { companyName: "+SUM(1,2)" });
    const normal = await lead("Plain", admin, { companyName: `${run}-co` });
    const created = await submit(admin, { entityType: "LEAD", actionKey: "lead.export", selection: { mode: "IDS", ids: [evil.id, normal.id] }, params: { format: "CSV" } });
    expect(await engine.processBulkJob(created.id)).toBe("COMPLETED");
    const dto = await svc.getBulkJob(admin, created.id);
    expect(dto.download?.available).toBe(true);
    expect(JSON.stringify(dto)).not.toContain("storageKey");
    const file = await svc.downloadBulkExport(admin, created.id);
    const csv = file.buffer.toString("utf8");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"") ${run}"`);
    expect(csv).toContain("'+SUM(1,2)");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    // Per-item copies of the data are removed once the file exists.
    expect((await items(created.id)).every((i) => JSON.stringify(i.result) === JSON.stringify({ exported: true }))).toBe(true);

    // Someone else — even a CRM admin who can see the job — can't download it.
    const other = await prisma.user.create({ data: { companyId: admin.companyId, email: `other.${run}@bulk-it.local`, passwordHash: "x", fullName: `Other ${run}` } });
    const otherActor = { companyId: admin.companyId, userId: other.id, branchId: null };
    await expectCode(svc.downloadBulkExport(otherActor, created.id), "PERMISSION_DENIED");
    // …and a user without admin rights can't even see it.
    await expectCode(svc.getBulkJob(rep, created.id), "NOT_FOUND");
    // Losing crm.export blocks the download too.
    denied.add(`${admin.userId}:crm.export`);
    await expectCode(svc.downloadBulkExport(admin, created.id), "PERMISSION_DENIED");
    denied.delete(`${admin.userId}:crm.export`);

    const xlsx = await submit(admin, { entityType: "LEAD", actionKey: "lead.export", selection: { mode: "IDS", ids: [evil.id, normal.id] }, params: { format: "XLSX" } });
    expect(await engine.processBulkJob(xlsx.id)).toBe("COMPLETED");
    const xf = await svc.downloadBulkExport(admin, xlsx.id);
    expect(xf.mimeType).toContain("spreadsheetml");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xf.buffer as unknown as ArrayBuffer);
    const names = wb.worksheets[0].getColumn(2).values.map(String);
    expect(names.some((v) => v.startsWith("'=HYPERLINK"))).toBe(true);

    // Expiry: purge deletes the file and the link stops working.
    expect(await engine.purgeExpiredExports(new Date(Date.now() + 8 * 24 * 3600 * 1000))).toBeGreaterThanOrEqual(2);
    await expectCode(svc.downloadBulkExport(admin, created.id), "NOT_FOUND");
  });

  it("job visibility: own jobs for everyone, all jobs for CRM admins", async () => {
    const mine = await lead("Vis rep", rep);
    const rj = await submit(rep, { entityType: "LEAD", actionKey: "lead.add_tags", selection: { mode: "IDS", ids: [mine.id] }, params: { tagNames: [`${run}-vis`] } });
    const repList = await svc.listBulkJobs(rep, {}, { page: 1, pageSize: 50, skip: 0, take: 50, sortBy: "createdAt", sortOrder: "desc" });
    expect(repList.data.every((j) => j.isMine)).toBe(true);
    expect(repList.data.map((j) => j.id)).toContain(rj.id);
    const adminView = await svc.getBulkJob(admin, rj.id);
    expect(adminView.isMine).toBe(false);
    const adminList = await svc.listBulkJobs(admin, {}, { page: 1, pageSize: 100, skip: 0, take: 100, sortBy: "createdAt", sortOrder: "desc" });
    expect(adminList.data.map((j) => j.id)).toContain(rj.id);
    const mineOnly = await svc.listBulkJobs(admin, { mine: true }, { page: 1, pageSize: 100, skip: 0, take: 100, sortBy: "createdAt", sortOrder: "desc" });
    expect(mineOnly.data.map((j) => j.id)).not.toContain(rj.id);
    const itemsPage = await svc.listBulkJobItems(rep, rj.id, {}, { page: 1, pageSize: 20, skip: 0, take: 20, sortBy: "sequence", sortOrder: "asc" });
    expect(itemsPage.data[0].label).toContain("Vis rep");
  });

  it("lead status / opportunity stage go through the same service rules", async () => {
    const statuses = await settings.listLeadStatuses(admin.companyId);
    const target = statuses.find((s) => s.isActive && s.kind === "OPEN" && !s.isDefault) ?? statuses.find((s) => s.isActive && s.kind === "LOST")!;
    const converted = statuses.find((s) => s.kind === "CONVERTED");
    const l = await lead("Status");
    if (converted) await expectCode(svc.previewBulkJob(admin, { entityType: "LEAD", actionKey: "lead.change_status", selection: { mode: "IDS", ids: [l.id] }, params: { statusId: converted.id } }), "VALIDATION_ERROR");
    const j = await submit(admin, { entityType: "LEAD", actionKey: "lead.change_status", selection: { mode: "IDS", ids: [l.id] }, params: { statusId: target.id } });
    expect(await engine.processBulkJob(j.id)).toBe("COMPLETED");
    expect((await prisma.crmLead.findUniqueOrThrow({ where: { id: l.id } })).statusId).toBe(target.id);

    const created = (await opps.createOpportunity(admin, { name: `Stage ${run}` })) as { id: string };
    const o = await prisma.crmOpportunity.findUniqueOrThrow({ where: { id: created.id }, select: { id: true, stageId: true } });
    const caps = await svc.getBulkCapabilities(admin, "OPPORTUNITY");
    const stageField = caps.actions.find((a) => a.key === "opportunity.change_stage")!.fields[0] as { options: { value: string }[] };
    const other = stageField.options.find((s) => s.value !== o.stageId)!;
    const sj = await submit(admin, { entityType: "OPPORTUNITY", actionKey: "opportunity.change_stage", selection: { mode: "IDS", ids: [o.id] }, params: { stageId: other.value } });
    const st = await engine.processBulkJob(sj.id);
    const item = (await items(sj.id))[0];
    expect(item.status).not.toBe("SKIPPED");
    // Either moved, or refused by the stage's own rules with the reason.
    if (st === "COMPLETED") expect((await prisma.crmOpportunity.findUniqueOrThrow({ where: { id: o.id } })).stageId).toBe(other.value);
    else expect(item.errorCode).toMatch(/CRM_STAGE_TRANSITION_BLOCKED|VALIDATION_ERROR/);
    // Same stage again → skipped with a reason.
    const again = await submit(admin, { entityType: "OPPORTUNITY", actionKey: "opportunity.change_stage", selection: { mode: "IDS", ids: [o.id] }, params: { stageId: (await prisma.crmOpportunity.findUniqueOrThrow({ where: { id: o.id } })).stageId } });
    await engine.processBulkJob(again.id);
    expect((await items(again.id))[0].message).toMatch(/already in this stage/i);
  });

  it("enrols records in a published workflow (Phase 18); the workflow's re-entry rule turns repeats into skips", async () => {
    const { id } = await wf.createWorkflow(admin, { name: `Bulk enrol ${run}`, trigger: "manual", entityType: "LEAD" });
    const w = await wf.getWorkflow(admin, id);
    await wf.saveDraft(admin, id, {
      version: w.version,
      definition: {
        schemaVersion: 1,
        trigger: { type: "manual", entityType: "LEAD", conditions: { kind: "group", logic: "AND", conditions: [] } },
        settings: { timezone: "Asia/Kolkata", reentry: "ONCE", allowWorkflowTriggers: false },
        entryNodeId: "n",
        nodes: [{ id: "n", type: "ACTION", action: "note.add", params: { body: `Bulk enrolled ${run}` }, next: null, onError: "STOP" }],
      },
    });
    await wf.publishWorkflow(admin, id, { version: (await wf.getWorkflow(admin, id)).version });
    const ls = [await lead("Enrol A"), await lead("Enrol B")];
    const caps = await svc.getBulkCapabilities(admin, "LEAD");
    expect((caps.actions.find((a) => a.key === "lead.enroll_workflow")!.fields[0] as { options: { value: string }[] }).options.map((o) => o.value)).toContain(id);
    const j1 = await submit(admin, { entityType: "LEAD", actionKey: "lead.enroll_workflow", selection: { mode: "IDS", ids: ls.map((l) => l.id) }, params: { workflowId: id } });
    expect(await engine.processBulkJob(j1.id)).toBe("COMPLETED");
    expect(await prisma.crmWorkflowExecution.count({ where: { workflowId: id, mode: "LIVE" } })).toBe(2);
    const j2 = await submit(admin, { entityType: "LEAD", actionKey: "lead.enroll_workflow", selection: { mode: "IDS", ids: ls.map((l) => l.id) }, params: { workflowId: id } });
    expect(await engine.processBulkJob(j2.id)).toBe("COMPLETED");
    expect((await job(j2.id)).skippedCount).toBe(2);
    expect(await prisma.crmWorkflowExecution.count({ where: { workflowId: id, mode: "LIVE" } })).toBe(2);
  });

  it("bulk changes trigger workflows exactly like manual changes (owner changed, tag added), traced to the bulk job", async () => {
    const wfEngine = await import("@/modules/crm/workflows/workflow-engine");
    const publish = async (name: string, trigger: string) => {
      const { id } = await wf.createWorkflow(admin, { name: `${name} ${run}`, trigger });
      const w = await wf.getWorkflow(admin, id);
      await wf.saveDraft(admin, id, {
        version: w.version,
        definition: {
          schemaVersion: 1,
          trigger: { type: trigger, conditions: { kind: "group", logic: "AND", conditions: [] } },
          settings: { timezone: "Asia/Kolkata", reentry: "ALWAYS", allowWorkflowTriggers: false },
          entryNodeId: "n",
          nodes: [{ id: "n", type: "ACTION", action: "note.add", params: { body: `${name} via workflow ${run}` }, next: null, onError: "STOP" }],
        },
      });
      await wf.publishWorkflow(admin, id, { version: (await wf.getWorkflow(admin, id)).version });
      return id;
    };
    await wfEngine.tickWorkflows(); // settle older events
    const ownerWf = await publish("On owner change", "lead.owner_changed");
    const tagWf = await publish("On tag added", "tag.added");
    const ls = [await lead("Trig A"), await lead("Trig B"), await lead("Trig C")];

    const assign = await submit(admin, { entityType: "LEAD", actionKey: "lead.assign", selection: { mode: "IDS", ids: ls.map((l) => l.id) }, params: { ownerUserId: owner2 } });
    expect(await engine.processBulkJob(assign.id)).toBe("COMPLETED");
    const tags = await submit(admin, { entityType: "LEAD", actionKey: "lead.add_tags", selection: { mode: "IDS", ids: ls.map((l) => l.id) }, params: { tagNames: [`${run}-trig`] } });
    expect(await engine.processBulkJob(tags.id)).toBe("COMPLETED");

    // The events carry the bulk job as their correlation id (not the workflow prefix).
    const events = await prisma.crmEvent.findMany({ where: { entityId: { in: ls.map((l) => l.id) }, eventType: { in: ["lead.owner_changed", "lead.tag_added"] } } });
    expect(events).toHaveLength(6);
    expect(new Set(events.map((e) => e.correlationId))).toEqual(new Set([`bulkjob:${assign.id}`, `bulkjob:${tags.id}`]));

    await wfEngine.tickWorkflows(); // dispatch: creates the executions
    await wfEngine.tickWorkflows(new Date(Date.now() + 1000)); // run them (as the worker's next tick would)
    const execs = await prisma.crmWorkflowExecution.findMany({ where: { workflowId: { in: [ownerWf, tagWf] }, mode: "LIVE" } });
    expect(execs.filter((e) => e.workflowId === ownerWf).map((e) => e.entityId).sort()).toEqual(ls.map((l) => l.id).sort());
    expect(execs.filter((e) => e.workflowId === tagWf).map((e) => e.entityId).sort()).toEqual(ls.map((l) => l.id).sort());
    expect(execs.every((e) => e.status === "COMPLETED" && e.depth === 0)).toBe(true);
    // …and the workflows' own actions ran on every record.
    expect(await prisma.crmNote.count({ where: { body: { contains: `via workflow ${run}` }, entityId: { in: ls.map((l) => l.id) } } })).toBe(6);
    for (const id of [ownerWf, tagWf]) await wf.changeWorkflowStatus(admin, id, "DISABLED", { version: (await wf.getWorkflow(admin, id)).version });
  });

  it("template messages: inactive templates are refused up front; records without a contact fail with the reason, nothing is sent", async () => {
    await expectCode(svc.previewBulkJob(admin, { entityType: "LEAD", actionKey: "lead.send_template", selection: { mode: "IDS", ids: [(await lead("Msg0")).id] }, params: { templateId: "00000000-0000-4000-8000-000000000000" } }), "VALIDATION_ERROR");
    const templates = await import("@/modules/crm/templates/crm-templates.service");
    const created = (await templates.createTemplate(admin, { name: `Bulk SMS ${run}`, channelType: "SMS", body: "Hi {{contact.first_name|there}}, thanks for your interest." })) as { id: string };
    await templates.changeTemplateStatus(admin, created.id, "activate", { version: ((await templates.getTemplate(admin, created.id)) as { version: number }).version });
    const t = { id: created.id };
    const caps = await svc.getBulkCapabilities(admin, "LEAD");
    expect((caps.actions.find((a) => a.key === "lead.send_template")!.fields[0] as { options: { value: string }[] }).options.map((o) => o.value)).toContain(t.id);
    const l = await lead("Msg");
    const before = await prisma.crmMessage.count();
    const j = await submit(admin, { entityType: "LEAD", actionKey: "lead.send_template", selection: { mode: "IDS", ids: [l.id] }, params: { templateId: t.id }, confirmCount: 1 });
    expect(await engine.processBulkJob(j.id)).toBe("FAILED");
    expect((await items(j.id))[0].errorCode).toBe("NO_CONTACT");
    expect(await prisma.crmMessage.count()).toBe(before);
  });
});
