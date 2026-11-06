import { z } from "zod";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { deleteStoredFile, readStoredFile, saveFile } from "@/core/file-storage/FileStorage";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { buildReportFile } from "./analytics-export";
import { ANALYTICS_LIMITS } from "./analytics-registry";
import { effectiveQuery, runLogged, savedDefinitionSchema } from "./analytics-reports.service";

/**
 * Phase 17 — scheduled (and send-now) delivery of a saved report.
 *
 * One run = one copy PER RECIPIENT, each generated with that recipient's own
 * permissions and record scope (never the owner's). The file goes to private
 * storage; the recipient gets an in-app notification and downloads it from
 * Analytics → Deliveries while it is valid (7 days). No email attachments.
 * A recipient who can no longer open Analytics, or can't see the report's
 * data, is SKIPPED and the reason is logged; nothing is sent to them.
 * Idempotent per (run key, recipient), so a retried job never sends twice.
 */

const TABLE = "sm_analytics_deliveries";

export interface DeliverySummary {
  delivered: number;
  skipped: number;
  failed: number;
  alreadyDone: number;
}

export async function deliverSavedReport(owner: SalesActor, reportId: string, runKey: string, now = new Date()): Promise<DeliverySummary> {
  const report = await prisma.smAnalyticsReport.findFirst({ where: { id: reportId, companyId: owner.companyId } });
  if (!report || report.isArchived) throw new BusinessRuleError("NOT_FOUND", "The saved report no longer exists.");
  if (report.ownerUserId !== owner.userId) throw new BusinessRuleError("PERMISSION_DENIED", "Only the report's owner can deliver it.");
  await PermissionService.assert(owner.userId, "sales_analytics", "edit");
  if (!report.recipientUserIds.length) throw new BusinessRuleError("VALIDATION_ERROR", "The report has no recipients. Add some on the report first.");
  const def = savedDefinitionSchema.parse(report.definition);
  const query = await effectiveQuery(owner.companyId, def);
  const users = new Map((await prisma.user.findMany({ where: { companyId: owner.companyId, id: { in: report.recipientUserIds } }, select: { id: true, fullName: true, defaultBranchId: true } })).map((u) => [u.id, u]));
  const done = new Set((await prisma.smAnalyticsDelivery.findMany({ where: { runKey, reportId }, select: { recipientUserId: true } })).map((d) => d.recipientUserId));
  const summary: DeliverySummary = { delivered: 0, skipped: 0, failed: 0, alreadyDone: 0 };

  for (const recipientId of report.recipientUserIds) {
    if (done.has(recipientId)) {
      summary.alreadyDone++;
      continue;
    }
    const base = { companyId: owner.companyId, reportId, recipientUserId: recipientId, runKey };
    const record = async (data: { status: "DELIVERED" | "SKIPPED" | "FAILED"; reason?: string | null; storageKey?: string; fileName?: string; mimeType?: string; fileSizeBytes?: number; rowCount?: number; expiresAt?: Date }) => {
      // The unique (run, recipient) key makes a concurrent duplicate a no-op.
      const row = await prisma.smAnalyticsDelivery.create({ data: { ...base, ...data } }).catch((e: { code?: string }) => (e?.code === "P2002" ? null : Promise.reject(e)));
      if (row) await writeAuditLog({ companyId: owner.companyId, userId: owner.userId, tableName: TABLE, recordId: row.id, action: "CREATE", newValues: { reportId, recipientUserId: recipientId, status: data.status, reason: data.reason ?? null, runKey } });
      return row;
    };
    const user = users.get(recipientId);
    if (!user) {
      summary.skipped++;
      await record({ status: "SKIPPED", reason: "The recipient isn't a user of this company any more." });
      continue;
    }
    // Inactive users fail every permission check, so this also covers suspended accounts.
    if (!(await PermissionService.can(recipientId, "sales_analytics", "view"))) {
      summary.skipped++;
      await record({ status: "SKIPPED", reason: "The recipient can't open Analytics." });
      continue;
    }
    const recipient: SalesActor = { companyId: owner.companyId, userId: recipientId, branchId: user.defaultBranchId ?? null };
    try {
      const result = await runLogged(recipient, query, "DELIVERY", reportId);
      const file = await buildReportFile(result, report.name, report.deliveryFormat === "CSV" ? "CSV" : "XLSX", user.fullName);
      const stored = await saveFile(file.buffer, file.fileName, file.mimeType);
      const missing = result.unavailableMetrics.length ? `Without ${result.unavailableMetrics.length} metric(s) the recipient can't see.` : null;
      const row = await record({ status: "DELIVERED", reason: missing, storageKey: stored.storageKey, fileName: file.fileName, mimeType: file.mimeType, fileSizeBytes: stored.fileSizeBytes, rowCount: result.rows.length, expiresAt: new Date(now.getTime() + ANALYTICS_LIMITS.deliveryFileDays * 86_400_000) });
      if (!row) {
        await deleteStoredFile(stored.storageKey).catch(() => undefined);
        summary.alreadyDone++;
        continue;
      }
      summary.delivered++;
      await createNotification({ companyId: owner.companyId, userId: recipientId, title: `Report ready: ${report.name}`, body: `${result.meta.period.from} to ${result.meta.period.to}. Download it from Sales & Marketing → Analytics → Deliveries within ${ANALYTICS_LIMITS.deliveryFileDays} days. It was prepared with your own access.` });
    } catch (e) {
      const denied = e instanceof BusinessRuleError && (e.code === "PERMISSION_DENIED" || e.code === "NOT_FOUND");
      if (denied) summary.skipped++;
      else summary.failed++;
      // Messages from the engine are user-facing and contain no data or secrets.
      await record({ status: denied ? "SKIPPED" : "FAILED", reason: denied ? `The recipient can't see this report's data (${(e as Error).message})` : e instanceof BusinessRuleError ? e.message : "The report couldn't be prepared." });
    }
  }
  return summary;
}

export const sendNowSchema = z.object({}).strict();

/** Owner's "send now" — the same per-recipient delivery, outside the schedule. */
export async function sendSavedReportNow(owner: SalesActor, reportId: string) {
  return deliverSavedReport(owner, reportId, `now:${reportId}:${Date.now()}`);
}

/** Recipient's own deliveries (any report) and, for owners, the delivery log of their reports. */
export async function listDeliveries(actor: SalesActor) {
  await PermissionService.assert(actor.userId, "sales_analytics", "view");
  const since = new Date(Date.now() - 60 * 86_400_000);
  const [mine, owned] = await Promise.all([
    prisma.smAnalyticsDelivery.findMany({ where: { companyId: actor.companyId, recipientUserId: actor.userId, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 200, include: { report: { select: { name: true } } } }),
    prisma.smAnalyticsDelivery.findMany({ where: { companyId: actor.companyId, report: { ownerUserId: actor.userId }, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 300, include: { report: { select: { name: true } } } }),
  ]);
  const names = new Map((await prisma.user.findMany({ where: { companyId: actor.companyId, id: { in: [...new Set(owned.map((d) => d.recipientUserId))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const now = Date.now();
  return {
    received: mine.map((d) => ({
      id: d.id,
      reportName: d.report.name,
      status: d.status,
      reason: d.reason,
      fileName: d.fileName,
      rowCount: d.rowCount,
      createdAt: d.createdAt.toISOString(),
      expiresAt: d.expiresAt?.toISOString() ?? null,
      downloadable: d.status === "DELIVERED" && !!d.storageKey && !!d.expiresAt && d.expiresAt.getTime() > now,
      downloadedAt: d.downloadedAt?.toISOString() ?? null,
    })),
    // The owner sees who got a copy and who was skipped — never the recipients' files.
    sent: owned.map((d) => ({ id: d.id, reportName: d.report.name, recipient: names.get(d.recipientUserId) ?? "Unknown user", status: d.status, reason: d.reason, createdAt: d.createdAt.toISOString() })),
  };
}

/** The recipient's file — only the recipient, only while valid, only with Analytics access. */
export async function downloadDelivery(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "sales_analytics", "view");
  const d = await prisma.smAnalyticsDelivery.findFirst({ where: { id, companyId: actor.companyId, recipientUserId: actor.userId } });
  if (!d || d.status !== "DELIVERED" || !d.storageKey) throw new BusinessRuleError("NOT_FOUND", "Delivery not found.");
  if (!d.expiresAt || d.expiresAt.getTime() <= Date.now()) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This download has expired. Ask the report's owner to send it again.");
  const buffer = await readStoredFile(d.storageKey);
  await prisma.smAnalyticsDelivery.update({ where: { id: d.id }, data: { downloadedAt: d.downloadedAt ?? new Date() } });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: d.id, action: "UPDATE", newValues: { downloaded: true } });
  return { buffer, fileName: d.fileName ?? "report", mimeType: d.mimeType ?? "application/octet-stream" };
}

/** Maintenance: remove expired files (the delivery row stays as history). */
export async function purgeExpiredDeliveryFiles(now = new Date()) {
  const rows = await prisma.smAnalyticsDelivery.findMany({ where: { expiresAt: { lt: now }, storageKey: { not: null } }, select: { id: true, storageKey: true }, take: 500 });
  for (const r of rows) {
    await deleteStoredFile(r.storageKey!).catch(() => undefined);
    await prisma.smAnalyticsDelivery.update({ where: { id: r.id }, data: { storageKey: null } });
  }
  return rows.length;
}

export const reportScheduleSchema = z
  .object({
    frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
    timeOfDay: z.string(),
    dayOfWeek: z.coerce.number().int().optional().nullable(),
    dayOfMonth: z.coerce.number().int().optional().nullable(),
  })
  .strict();

/**
 * Schedules a saved report's delivery on the Phase 14 schedule engine (owner
 * only, report must have recipients). Pause / resume / delete use the normal
 * schedule endpoints.
 */
export async function scheduleSavedReport(owner: SalesActor, reportId: string, raw: unknown) {
  const rule = reportScheduleSchema.parse(raw);
  const report = await prisma.smAnalyticsReport.findFirst({ where: { id: reportId, companyId: owner.companyId, isArchived: false } });
  if (!report || report.ownerUserId !== owner.userId) throw new BusinessRuleError("NOT_FOUND", "Saved report not found.", { id: reportId });
  if (!report.recipientUserIds.length) throw new BusinessRuleError("VALIDATION_ERROR", "Add recipients to the report before scheduling it.");
  const { createBulkSchedule } = await import("@/modules/bulk-actions/bulk-schedules.service");
  const { ANALYTICS_REPORT_ENTITY, ANALYTICS_DELIVER_ACTION } = await import("./analytics-bulk");
  return createBulkSchedule({ ...owner, branchId: owner.branchId ?? null }, { name: `Deliver: ${report.name}`.slice(0, 120), entityType: ANALYTICS_REPORT_ENTITY, actionKey: ANALYTICS_DELIVER_ACTION, filterQuery: `reportId=${report.id}`, params: {}, ...rule });
}

/** Schedules delivering this report (any owner's, for admins of the record type). */
export async function listReportSchedules(actor: SalesActor, reportId: string) {
  const { listBulkSchedules } = await import("@/modules/bulk-actions/bulk-schedules.service");
  const { ANALYTICS_REPORT_ENTITY } = await import("./analytics-bulk");
  return (await listBulkSchedules({ ...actor, branchId: actor.branchId ?? null }, { entityTypes: [ANALYTICS_REPORT_ENTITY], includePaused: true })).filter((s) => s.filterQuery === `reportId=${reportId}`);
}
