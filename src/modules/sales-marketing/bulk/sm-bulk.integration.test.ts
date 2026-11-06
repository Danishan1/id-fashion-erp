/**
 * Sales & Marketing Phase 14 — shared bulk operations against a real, migrated
 * Postgres database: S&M bulk actions through their own services, per-record
 * dry run → "run for real", exports (campaign budget figures, formula-safe),
 * promotion pause, quotation draft checks, attribution recalculation through
 * the Phase 13 run service, saved schedules (no overlap, failures pause),
 * active-job limits, tenant isolation, and the enquiry CSV import.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database.
 * Only permissions are mocked (all granted except what a test denies). The
 * queue is not used: tests call the processor / schedule tick directly.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;
process.env.AUTH_SECRET ??= "sm-bulk-it-secret";
process.env.FILE_STORAGE_ROOT = mkdtempSync(path.join(tmpdir(), "sm-bulk-it-"));
delete process.env.REDIS_URL;

const viewAllUsers = new Set<string>();
const denied = new Set<string>(); // `${userId}:${module}.${action}`
const can = async (userId: string, module: string, action: string) => {
  if (denied.has(`${userId}:${module}.${action}`)) return false;
  return action === "view_all" ? viewAllUsers.has(userId) : true;
};
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(can),
    assert: vi.fn(async (userId: string, module: string, action: string) => {
      if (!(await can(userId, module, action))) {
        const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
        throw new BusinessRuleError("PERMISSION_DENIED", "denied");
      }
    }),
    assertAny: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("S&M bulk operations (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const svc = await import("@/modules/bulk-actions/bulk-jobs.service");
  const engine = await import("@/modules/bulk-actions/bulk-engine");
  const schedules = await import("@/modules/bulk-actions/bulk-schedules.service");
  const { readStoredFile } = await import("@/core/file-storage/FileStorage");
  const enquiries = await import("../enquiries/sales-enquiry.service");
  const quotations = await import("../quotations/quotation.service");
  const life = await import("../quotations/quotation-lifecycle.service");
  const models = await import("../attribution/attribution-model.service");
  const promos = await import("../promotions/promotion.service");
  const lookups = await import("../campaigns/campaign-lookup.service");
  const imports = await import("@/modules/import/bulk-import.service");
  const { ImportBatchRepository } = await import("@/modules/import/import.repository");
  const { alignEnquiryCounter } = await import("../integration-test-helpers");

  const run = `sb${Date.now().toString(36)}`;
  const RUN = run.toUpperCase();
  let admin: Actor, rep: Actor, approver: Actor, outsider: Actor;
  let owner2 = "";
  const today = new Date().toISOString().slice(0, 10);
  const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });
  const items = (jobId: string) => prisma.bulkJobItem.findMany({ where: { jobId }, orderBy: { sequence: "asc" } });
  const enquiry = async (subject: string, extra: Record<string, unknown> = {}) =>
    (await enquiries.createSalesEnquiry(admin, { prospectName: `Prospect ${run}`, enquiryDate: today, subject: `${subject} ${run}`, lines: [{ styleNameFreeText: "Shirt" }], ...extra })).id;

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    await alignEnquiryCounter(prisma, company.id);
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@smbulk-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [a, r, ap, o2] = await Promise.all([mk("admin"), mk("rep"), mk("approver"), mk("owner2")]);
    const actor = (id: string) => ({ companyId: company.id, userId: id, branchId: null });
    [admin, rep, approver] = [actor(a.id), actor(r.id), actor(ap.id)];
    owner2 = o2.id;
    viewAllUsers.add(a.id);
    // The rep is not an S&M admin: sees only own bulk jobs / schedules.
    denied.add(`${r.id}:sales_marketing_settings.edit`);
    const other = await prisma.company.create({ data: { name: `Other ${run}`, baseCurrencyCode: "INR" } });
    outsider = { companyId: other.id, userId: a.id, branchId: null };
  });

  afterAll(async () => {
    await prisma.bulkJobSchedule.updateMany({ where: { name: { contains: run } }, data: { status: "PAUSED", nextRunAt: null, archivedAt: new Date() } });
    await prisma.marketingAttributionModel.updateMany({ where: { code: { contains: RUN } }, data: { status: "RETIRED", isDefault: false } });
    await prisma.marketingPromotion.updateMany({ where: { code: { contains: RUN } }, data: { status: "ARCHIVED" } });
    await prisma.$disconnect();
  });

  it("offers the registered S&M actions with dry-run / schedule flags", async () => {
    const caps = await svc.getBulkCapabilities(admin, "ENQUIRY");
    const byKey = Object.fromEntries(caps.actions.map((a) => [a.key, a]));
    expect(byKey["enquiry.assign"]).toMatchObject({ available: true, dryRun: true, schedulable: false });
    expect(byKey["enquiry.export"]).toMatchObject({ available: true, dryRun: false, schedulable: true });
    // A client can't name an action of another entity.
    await expectCode(svc.previewBulkJob(admin, { entityType: "ENQUIRY", actionKey: "promotion.pause", selection: { mode: "IDS", ids: [crypto.randomUUID()] }, params: {} }), "VALIDATION_ERROR");
  });

  it("enquiry assign: dry run changes nothing, then runs for real on the would-succeed records only", async () => {
    const e1 = await enquiry("Assign one");
    const e2 = await enquiry("Already owned", { ownerUserId: owner2 });
    const e3 = await enquiry("Lost one");
    await enquiries.changeSalesEnquiryStage(admin, e3, { stage: "LOST", reason: "Went elsewhere" });

    const dry = await svc.createBulkJob(admin, { entityType: "ENQUIRY", actionKey: "enquiry.assign", selection: { mode: "IDS", ids: [e1, e2, e3] }, params: { ownerUserId: owner2 }, dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(await engine.processBulkJob(dry.id)).toBe("COMPLETED_WITH_ERRORS");
    const outcome = Object.fromEntries((await items(dry.id)).map((i) => [i.entityId, i.status]));
    expect(outcome).toEqual({ [e1]: "SUCCEEDED", [e2]: "SKIPPED", [e3]: "FAILED" });
    // Nothing changed.
    expect((await prisma.buyerEnquiry.findUniqueOrThrow({ where: { id: e1 } })).ownerUserId).toBe(admin.userId);
    expect(await prisma.notification.count({ where: { userId: owner2, relatedRecordId: e1 } })).toBe(0);

    const detail = await svc.getBulkJob(admin, dry.id);
    expect(detail).toMatchObject({ canRunForReal: true, wouldSucceedCount: 1, realRun: null });
    // Only the person who ran the dry run.
    await expectCode(svc.runBulkJobForReal(rep, dry.id, {}), "NOT_FOUND");

    const real = await svc.runBulkJobForReal(admin, dry.id, {});
    expect(real).toMatchObject({ dryRun: false, dryRunOfJobId: dry.id, totalCount: 1, duplicate: false });
    expect((await svc.runBulkJobForReal(admin, dry.id, {})).id).toBe(real.id); // once per dry run
    expect(await engine.processBulkJob(real.id)).toBe("COMPLETED");
    expect((await prisma.buyerEnquiry.findUniqueOrThrow({ where: { id: e1 } })).ownerUserId).toBe(owner2);
    // Through the service: activity + notification, as when done by hand.
    expect(await prisma.buyerEnquiryActivity.count({ where: { buyerEnquiryId: e1, type: "OWNER_CHANGED" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: owner2, relatedRecordId: e1 } })).toBe(1);
    expect((await svc.getBulkJob(admin, dry.id)).realRun?.id).toBe(real.id);
  });

  it("refuses a dry run for an export, and an action the user can't use", async () => {
    const e = await enquiry("Export guard");
    await expectCode(svc.createBulkJob(admin, { entityType: "ENQUIRY", actionKey: "enquiry.export", selection: { mode: "IDS", ids: [e] }, params: { format: "CSV" }, dryRun: true }), "VALIDATION_ERROR");
    denied.add(`${rep.userId}:sales_marketing.export`);
    try {
      await expectCode(svc.createBulkJob(rep, { entityType: "ENQUIRY", actionKey: "enquiry.export", selection: { mode: "IDS", ids: [e] }, params: { format: "CSV" } }), "PERMISSION_DENIED");
    } finally {
      denied.delete(`${rep.userId}:sales_marketing.export`);
    }
  });

  it("filter selection uses the list's own filters; other companies' records never enter a job", async () => {
    await enquiry("Filter A");
    await enquiry("Filter B");
    const p = await svc.previewBulkJob(admin, { entityType: "ENQUIRY", actionKey: "enquiry.export", selection: { mode: "FILTER", filterQuery: `view=all&search=Filter+A+${run}` }, params: { format: "CSV" } });
    expect(p.count).toBe(1);
    const mine = await enquiry("Tenant check");
    const p2 = await svc.previewBulkJob(outsider, { entityType: "ENQUIRY", actionKey: "enquiry.export", selection: { mode: "IDS", ids: [mine] }, params: { format: "CSV" } });
    expect(p2.count).toBe(0);
  });

  it("exports campaigns with their budget figures, formula-safe", async () => {
    await lookups.ensureCampaignLookups(admin.companyId);
    const all = await prisma.marketingCampaignLookup.findMany({ where: { companyId: admin.companyId } });
    const c = await prisma.marketingCampaign.create({
      data: { companyId: admin.companyId, code: `SB-${RUN}`, name: `=HYPERLINK("x") ${run}`, typeId: all.find((l) => l.kind === "TYPE")!.id, objectiveId: all.find((l) => l.kind === "OBJECTIVE")!.id, ownerUserId: admin.userId, status: "ACTIVE", plannedStartDate: new Date("2026-09-01"), plannedEndDate: new Date("2026-12-31"), actualStartDate: new Date("2026-09-01"), plannedBudget: 50000, approvedRevisionNumber: 1, currencyCode: "INR", createdByUserId: admin.userId, updatedByUserId: admin.userId },
    });
    await prisma.expense.create({ data: { companyId: admin.companyId, expenseNumber: `SBX-${RUN}`, expenseDate: new Date("2026-10-15"), description: "Print", amount: 2000, taxAmount: 360, totalAmount: 2360, currencyCode: "INR", status: "APPROVED", campaignId: c.id, createdByUserId: admin.userId } });
    const job = await svc.createBulkJob(admin, { entityType: "CAMPAIGN", actionKey: "campaign.export", selection: { mode: "IDS", ids: [c.id] }, params: { format: "CSV" } });
    expect(await engine.processBulkJob(job.id)).toBe("COMPLETED");
    const file = ((await prisma.bulkJob.findUniqueOrThrow({ where: { id: job.id } })).result as { file: { storageKey: string } }).file;
    const csv = (await readStoredFile(file.storageKey)).toString("utf8");
    expect(csv).toContain("Approved budget,Actual spend,Committed");
    expect(csv).toContain(`SB-${RUN}`);
    expect(csv).toContain(`'=HYPERLINK`); // never a live formula
    const row = csv.split("\r\n").find((l) => l.includes(`SB-${RUN}`))!;
    expect(row).toContain(",50000,2000,");
  });

  it("pauses promotions through the promotion service; already-paused ones are skipped", async () => {
    const pcs = (await prisma.unitOfMeasure.findFirstOrThrow({ where: { code: "PCS" } })).id;
    const style = (await prisma.product.create({ data: { companyId: admin.companyId, styleCode: `SBP-${run}`, styleName: `Bulk Polo ${run}`, itemType: "STYLE", baseUomId: pcs } })).id;
    // Created by the admin, approved by someone else, switched on — as on screen.
    const live = async (c: string) => {
      const { id } = await promos.createPromotion(admin, { code: `${c}${RUN}`.slice(0, 30), name: c, applyMode: "AUTO", terms: { validFrom: today, discountType: "PERCENT", value: 5, stacking: "EXCLUSIVE", productIds: [style] } });
      const v = await prisma.marketingPromotionVersion.findFirstOrThrow({ where: { promotionId: id } });
      await promos.submitVersion(admin, id, v.id, {});
      await promos.approveVersion(approver, id, v.id, {});
      await promos.promotionAction(approver, id, "activate", {});
      return { id };
    };
    const [on, paused] = [await live("ON"), await live("PZ")];
    await promos.promotionAction(admin, paused.id, "pause", {});
    const job = await svc.createBulkJob(admin, { entityType: "PROMOTION", actionKey: "promotion.pause", selection: { mode: "IDS", ids: [on.id, paused.id] }, params: { comment: "Stock-out" } });
    expect(await engine.processBulkJob(job.id)).toBe("COMPLETED");
    expect((await items(job.id)).map((i) => i.status)).toEqual(["SUCCEEDED", "SKIPPED"]);
    expect((await prisma.marketingPromotion.findUniqueOrThrow({ where: { id: on.id } })).status).toBe("PAUSED");
    expect(await prisma.pricingEvent.count({ where: { entityId: on.id, type: "PAUSE", comment: "Stock-out" } })).toBe(1);
  });

  it("checks quotation drafts without changing them", async () => {
    const customer = (await prisma.customer.create({ data: { companyId: admin.companyId, code: `SBQ-${run}`, name: `Bulk Q ${run}` } })).id;
    const taxType = await prisma.taxType.create({ data: { companyId: admin.companyId, code: `SBG-${run}`, name: "GST" } });
    const gst = (await prisma.taxRate.create({ data: { companyId: admin.companyId, taxTypeId: taxType.id, name: `GST 5% ${run}`, ratePercentage: "5", effectiveFrom: new Date("2020-01-01") } })).id;
    const body = (t: string) => ({ customerId: customer, title: `${run} ${t}`, quotationDate: today, validUntil: plusDays(30), lines: [{ description: "Polo", quantity: 10, unitPrice: 100, discountPercent: 0, taxRateId: gst }] });
    const draft = await quotations.createQuotation(admin, body("draft"));
    const cancelled = await quotations.createQuotation(admin, body("cancelled"));
    await life.cancelQuotation(admin, cancelled.id, { reason: "Duplicate request" });
    const before = await prisma.quotationRevision.findFirstOrThrow({ where: { quotationId: draft.id } });
    const job = await svc.createBulkJob(admin, { entityType: "QUOTATION", actionKey: "quotation.check_drafts", selection: { mode: "IDS", ids: [draft.id, cancelled.id] }, params: {} });
    expect(await engine.processBulkJob(job.id)).toBe("COMPLETED");
    const [a, b] = await items(job.id);
    expect(a).toMatchObject({ status: "SUCCEEDED" });
    expect(a.message).toMatch(/Ready to issue|needs approval/);
    expect(b).toMatchObject({ status: "SKIPPED", message: "Not a draft — nothing to check." });
    const after = await prisma.quotationRevision.findFirstOrThrow({ where: { quotationId: draft.id } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");
  });

  it("recalculates attribution models through the run service; a busy model is skipped", async () => {
    const { id } = await models.createModel(admin, { code: `SBM-${RUN}`, name: "Bulk linear", rules: { modelType: "LINEAR", windowDays: 30, touchpointTypes: ["MESSAGE_SENT"], conversionTypes: ["SALES_ORDER_BOOKED"], collapseRepeats: true } });
    const v = await prisma.marketingAttributionModelVersion.findFirstOrThrow({ where: { modelId: id } });
    await models.submitVersion(admin, id, v.id, {});
    await models.approveVersion(approver, id, v.id, {});

    const dry = await svc.createBulkJob(admin, { entityType: "ATTRIBUTION_MODEL", actionKey: "attribution_model.recalculate", selection: { mode: "IDS", ids: [id] }, params: { period: "LAST_30" }, dryRun: true });
    expect(await engine.processBulkJob(dry.id)).toBe("COMPLETED");
    expect(await prisma.marketingAttributionRun.count({ where: { modelId: id } })).toBe(0); // dry run queued nothing

    const job = await svc.createBulkJob(admin, { entityType: "ATTRIBUTION_MODEL", actionKey: "attribution_model.recalculate", selection: { mode: "IDS", ids: [id] }, params: { period: "LAST_30" } });
    expect(await engine.processBulkJob(job.id)).toBe("COMPLETED");
    const [it1] = await items(job.id);
    const runId = (it1.result as { runId: string }).runId;
    const r = await prisma.marketingAttributionRun.findUniqueOrThrow({ where: { id: runId } });
    expect(r).toMatchObject({ status: "COMPLETED", periodTo: new Date(`${today}T00:00:00Z`), idempotencyKey: `bulk:${job.id}:${id}` });

    // Busy: another calculation of this version is queued.
    const busy = await prisma.marketingAttributionRun.create({ data: { companyId: admin.companyId, modelId: id, modelVersionId: v.id, periodFrom: new Date("2026-01-01"), periodTo: new Date("2026-01-31"), trigger: "MANUAL", requestedByUserId: admin.userId } });
    try {
      const job2 = await svc.createBulkJob(admin, { entityType: "ATTRIBUTION_MODEL", actionKey: "attribution_model.recalculate", selection: { mode: "IDS", ids: [id] }, params: { period: "LAST_30" } });
      expect(await engine.processBulkJob(job2.id)).toBe("COMPLETED");
      expect((await items(job2.id))[0]).toMatchObject({ status: "SKIPPED", message: "A calculation of this model is already queued or running." });
    } finally {
      await prisma.marketingAttributionRun.update({ where: { id: busy.id }, data: { status: "FAILED", finishedAt: new Date() } });
    }
  });

  it("schedules: exports & recalcs only; due runs start as the owner, never overlap, and failures pause the schedule", async () => {
    await enquiry("Scheduled", { ownerUserId: rep.userId });
    await expectCode(
      schedules.createBulkSchedule(rep, { name: `Assign ${run}`, entityType: "ENQUIRY", actionKey: "enquiry.assign", filterQuery: "", params: {}, frequency: "DAILY", timeOfDay: "07:00" }),
      "VALIDATION_ERROR"
    );
    const s = await schedules.createBulkSchedule(rep, { name: `Daily export ${run}`, entityType: "ENQUIRY", actionKey: "enquiry.export", filterQuery: `view=all&search=${run}`, params: { format: "CSV" }, frequency: "WEEKLY", timeOfDay: "07:30", dayOfWeek: 1 });
    expect(s).toMatchObject({ status: "ACTIVE", when: "Every Monday at 07:30 IST", owner: { id: rep.userId } });
    // Visible to its owner and to S&M admins; not to another company.
    expect((await schedules.listBulkSchedules(rep, {})).map((x) => x.id)).toContain(s.id);
    expect((await schedules.listBulkSchedules(admin, {})).map((x) => x.id)).toContain(s.id);
    await expectCode(schedules.getBulkSchedule(outsider, s.id), "NOT_FOUND");

    const due = async () => {
      await prisma.bulkJobSchedule.update({ where: { id: s.id }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
      return schedules.runDueBulkSchedules(new Date());
    };
    expect((await due()).started).toContain(s.id);
    const first = await prisma.bulkJobSchedule.findUniqueOrThrow({ where: { id: s.id } });
    expect(first.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    const job = await prisma.bulkJob.findUniqueOrThrow({ where: { id: first.lastJobId! } });
    expect(job).toMatchObject({ scheduleId: s.id, requestedByUserId: rep.userId, actionKey: "enquiry.export", status: "QUEUED" });

    // The previous run is still queued → the next one is skipped, not stacked.
    expect((await due()).skipped).toContain(s.id);
    expect((await prisma.bulkJobSchedule.findUniqueOrThrow({ where: { id: s.id } })).lastOutcome).toBe("SKIPPED_OVERLAP");
    expect(await engine.processBulkJob(job.id)).toBe("COMPLETED");
    expect((await prisma.bulkJobSchedule.findUniqueOrThrow({ where: { id: s.id } })).lastOutcome).toBe("COMPLETED");
    expect((await svc.listBulkJobs(rep, { scheduleId: s.id }, { page: 1, pageSize: 10, skip: 0, take: 10, sortBy: "createdAt", sortOrder: "desc" } as never)).data.map((j) => j.id)).toEqual([job.id]);

    // The owner loses the export permission: each run fails to start; the third pauses it.
    denied.add(`${rep.userId}:sales_marketing.export`);
    try {
      for (let i = 0; i < 3; i++) expect((await due()).failed).toContain(s.id);
      const paused = await prisma.bulkJobSchedule.findUniqueOrThrow({ where: { id: s.id } });
      expect(paused).toMatchObject({ status: "PAUSED", nextRunAt: null, consecutiveFailures: 3, lastOutcome: "FAILED_TO_START" });
      expect(await prisma.notification.count({ where: { userId: rep.userId, title: { startsWith: "Schedule paused" } } })).toBe(1);
      await expectCode(schedules.bulkScheduleAction(rep, s.id, { action: "resume", version: paused.version }), "PERMISSION_DENIED");
    } finally {
      denied.delete(`${rep.userId}:sales_marketing.export`);
    }
    const p = await prisma.bulkJobSchedule.findUniqueOrThrow({ where: { id: s.id } });
    const resumed = await schedules.bulkScheduleAction(rep, s.id, { action: "resume", version: p.version });
    expect(resumed).toMatchObject({ status: "ACTIVE", consecutiveFailures: 0 });
    await expectCode(schedules.bulkScheduleAction(rep, s.id, { action: "pause", version: p.version }), "RECORD_VERSION_CONFLICT");
    expect(await schedules.bulkScheduleAction(rep, s.id, { action: "delete", version: p.version + 1 })).toMatchObject({ deleted: true });
    expect(await prisma.bulkJob.count({ where: { scheduleId: s.id } })).toBe(1); // past runs stay
  });

  it("limits how many bulk jobs one user can have running", async () => {
    const e = await enquiry("Capacity", { ownerUserId: approver.userId });
    const ids: string[] = [];
    try {
      for (let i = 0; i < 5; i++) ids.push((await svc.createBulkJob(approver, { entityType: "ENQUIRY", actionKey: "enquiry.export", selection: { mode: "IDS", ids: [e] }, params: { format: "CSV" } })).id);
      await expectCode(svc.createBulkJob(approver, { entityType: "ENQUIRY", actionKey: "enquiry.export", selection: { mode: "IDS", ids: [e] }, params: { format: "CSV" } }), "RATE_LIMITED");
    } finally {
      for (const id of ids) await svc.cancelBulkJob(approver, id);
    }
    expect((await svc.createBulkJob(approver, { entityType: "ENQUIRY", actionKey: "enquiry.export", selection: { mode: "IDS", ids: [e] }, params: { format: "CSV" } })).status).toBe("QUEUED");
  });

  it("imports enquiries from a file: validation preview writes nothing; rows go through the enquiry service", async () => {
    const existingSubject = `Existing ${run}`;
    await enquiries.createSalesEnquiry(admin, { prospectName: `Dup Prospect ${run}`, enquiryDate: "2026-11-01", subject: existingSubject, lines: [{ styleNameFreeText: "Tee" }] });
    const row = (extra: Record<string, string>) => ({ enquiryDate: "2026-11-02", prospectName: `Import Prospect ${run}`, subject: `Imported ${run}`, styleName: "Linen shirt", targetQuantity: "1,200", priority: "high", source: "trade show", ...extra });
    const rows = [
      row({}),
      row({ customerCode: `NOPE-${run}`, prospectName: "" }),
      row({}), // same as row 1 in this file
      { enquiryDate: "2026-11-01", prospectName: `Dup Prospect ${run}`, subject: existingSubject, styleName: "Tee" },
      row({ enquiryDate: "02/11/2026", subject: `Bad date ${run}` }),
      row({ subject: `Owner ${run}`, ownerEmail: `owner2.${run}@smbulk-it.local` }),
    ];
    const before = await prisma.buyerEnquiry.count({ where: { companyId: admin.companyId } });
    const v = await imports.validateBulkImportRows(admin, "BUYER_ENQUIRY", rows);
    expect(await prisma.buyerEnquiry.count({ where: { companyId: admin.companyId } })).toBe(before);
    expect(v.validCount).toBe(2);
    expect(v.errors.map((e) => e.rowNumber)).toEqual([2, 3, 4, 5]);
    expect(v.errors[0].reason).toContain(`Customer code "NOPE-${run}" not found`);
    expect(v.errors[2].reason).toMatch(/duplicate of ENQ-/);

    const batch = await ImportBatchRepository.createQueued({ companyId: admin.companyId, importType: "BUYER_ENQUIRY", fileName: `${run}.csv`, totalRows: rows.length, originalFileKey: null, createdByUserId: admin.userId });
    await imports.processBulkImportJob(batch.id, "BUYER_ENQUIRY", admin, rows, async () => undefined);
    const done = await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    // Row 3 now fails at commit time against the enquiry row 1 just created.
    expect([done.importedCount, done.skippedCount]).toEqual([2, 4]);
    const created = await prisma.buyerEnquiry.findFirstOrThrow({ where: { companyId: admin.companyId, subject: `Imported ${run}` }, include: { lines: true } });
    expect(created).toMatchObject({ priority: "HIGH", source: "TRADE_SHOW", ownerUserId: admin.userId, prospectName: `Import Prospect ${run}` });
    expect(Number(created.lines[0].targetQuantity)).toBe(1200);
    expect((await prisma.buyerEnquiry.findFirstOrThrow({ where: { subject: `Owner ${run}` } })).ownerUserId).toBe(owner2);
  });
});
