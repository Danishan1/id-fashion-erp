import { Prisma, type BulkJob, type BulkJobItemStatus, type BulkJobStatus } from "@prisma/client";
import { ZodError } from "zod";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { readStoredFile } from "@/core/file-storage/FileStorage";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { ListQuery } from "@/lib/list-query";
import "./bulk-registrations";
import { isTerminalBulkStatus, refreshBulkCounters } from "./bulk-engine";
import { BULK_ABSOLUTE_MAX_ITEMS, BULK_ITEM_STATUSES, BULK_JOB_STATUSES, bulkPreviewSchema, createBulkJobSchema, retryBulkJobSchema, type BulkJobFilters, type BulkSelectionInput } from "./bulk-job.schema";
import { enqueueBulkJob } from "./bulk-queue";
import { actionAvailability, getAvailableActions, getEntity, getHandler, listEntities } from "./bulk-registry";
import { buildSafeCsv, sanitizeSpreadsheetCell } from "./bulk-safety";
import type { BulkActionDefinition, BulkActor, BulkEntityDefinition } from "./bulk-types";

/**
 * Phase 14 — bulk job API layer: capabilities, preview, submit, list, detail,
 * items, cancel, retry, error report, export download. Processing happens in
 * the worker (bulk-engine.ts); this file never processes records itself.
 *
 * Visibility: a user sees their own jobs; holders of an entity's admin
 * permission (CRM: crm_settings.edit) see and manage every job of that entity.
 */

type Handler = BulkActionDefinition<Record<string, unknown>>;

function resolveDefinitions(entityType: string, actionKey: string): { entity: BulkEntityDefinition; handler: Handler } {
  const entity = getEntity(entityType);
  const handler = entity ? getHandler(entityType, actionKey) : null;
  // Same answer for "unknown entity", "unknown action" and "action of another entity".
  if (!entity || !handler) throw new BusinessRuleError("VALIDATION_ERROR", "Unknown bulk action for this record type.", { fieldErrors: { actionKey: "Choose an available action." } });
  return { entity, handler };
}

async function assertCanUse(actor: BulkActor, entity: BulkEntityDefinition, handler: Handler) {
  if (!(await PermissionService.can(actor.userId, entity.viewPermission.module, entity.viewPermission.action))) throw new BusinessRuleError("PERMISSION_DENIED", `You can't view ${entity.pluralLabel.toLowerCase()}.`);
  const av = await actionAvailability(actor, handler);
  if (!av.available) {
    const code = handler.unavailableReason || handler.availability ? "VALIDATION_ERROR" : "PERMISSION_DENIED";
    throw new BusinessRuleError(code, av.reason ?? "This action is not available.", { unavailable: true });
  }
}

function maxItemsFor(handler: Handler) {
  return Math.min(handler.maxItems, BULK_ABSOLUTE_MAX_ITEMS);
}

async function parseParams(actor: BulkActor, handler: Handler, raw: unknown) {
  let parsed: Record<string, unknown>;
  try {
    parsed = handler.paramsSchema.parse(raw ?? {});
  } catch (e) {
    if (e instanceof ZodError) {
      const fieldErrors = Object.fromEntries(e.issues.map((i) => [i.path.join(".") || "params", i.message]));
      throw new BusinessRuleError("VALIDATION_ERROR", "Check the action's settings.", { fieldErrors });
    }
    throw e;
  }
  return handler.prepare ? handler.prepare(actor, parsed) : { params: parsed, summary: handler.label, warnings: [] as string[] };
}

/** Turns a selection into the ordered, de-duplicated, visible record ids (the job's snapshot). */
async function resolveSelection(actor: BulkActor, entity: BulkEntityDefinition, handler: Handler, selection: BulkSelectionInput) {
  const max = maxItemsFor(handler);
  const warnings: string[] = [];
  if (selection.mode === "FILTER") {
    let filter: Record<string, unknown>;
    try {
      filter = entity.parseFilterQuery(selection.filterQuery);
    } catch {
      throw new BusinessRuleError("VALIDATION_ERROR", "The list filters couldn't be read. Reload the list and try again.", { fieldErrors: { selection: "Invalid filter." } });
    }
    const { ids, total } = await entity.resolveFilterIds(actor, filter, max + 1);
    if (total > max) {
      throw new BusinessRuleError("VALIDATION_ERROR", `The filter matches ${total.toLocaleString("en-IN")} ${entity.pluralLabel.toLowerCase()}; "${handler.label}" handles up to ${max.toLocaleString("en-IN")} at once. Narrow the filter.`, { total, maxItems: max });
    }
    return { ids, filter, warnings, requested: total };
  }
  const unique = [...new Set(selection.ids)];
  if (unique.length > max) throw new BusinessRuleError("VALIDATION_ERROR", `"${handler.label}" handles up to ${max.toLocaleString("en-IN")} records at once; ${unique.length.toLocaleString("en-IN")} were selected.`, { maxItems: max });
  const visible = await entity.visibleIds(actor, unique);
  const ids = unique.filter((id) => visible.has(id));
  const hidden = unique.length - ids.length;
  if (hidden > 0) warnings.push(`${hidden} selected record(s) no longer exist or are not visible to you and will be left out.`);
  return { ids, filter: null, warnings, requested: unique.length };
}

// ── Capabilities & preview ───────────────────────────────────────

export async function getBulkCapabilities(actor: BulkActor, entityType: string) {
  const entity = getEntity(entityType);
  if (!entity) throw new BusinessRuleError("NOT_FOUND", "Bulk actions aren't available for this record type.");
  const actions = await getAvailableActions(actor, entityType);
  return { entity: { entityType: entity.entityType, label: entity.label, pluralLabel: entity.pluralLabel }, actions };
}

export async function previewBulkJob(actor: BulkActor, raw: unknown) {
  const input = bulkPreviewSchema.parse(raw);
  const { entity, handler } = resolveDefinitions(input.entityType, input.actionKey);
  await assertCanUse(actor, entity, handler);
  const prepared = await parseParams(actor, handler, input.params);
  const sel = await resolveSelection(actor, entity, handler, input.selection);
  const labels = await entity.recordLabels(actor.companyId, sel.ids.slice(0, 5));
  return {
    entityType: entity.entityType,
    actionKey: handler.key,
    actionLabel: handler.label,
    count: sel.ids.length,
    requested: sel.requested,
    maxItems: maxItemsFor(handler),
    summary: prepared.summary,
    warnings: [...(prepared.warnings ?? []), ...sel.warnings],
    destructive: Boolean(handler.destructive),
    confirmation: handler.confirmation,
    sample: sel.ids.slice(0, 5).map((id) => labels.get(id) ?? id),
  };
}

// ── Submit ───────────────────────────────────────────────────────

export async function createBulkJob(actor: BulkActor, raw: unknown) {
  const input = createBulkJobSchema.parse(raw);
  if (input.idempotencyKey) {
    const existing = await prisma.bulkJob.findFirst({ where: { companyId: actor.companyId, requestedByUserId: actor.userId, idempotencyKey: input.idempotencyKey } });
    if (existing) return { ...(await presentJob(existing, actor)), duplicate: true, queued: true, warnings: [] as string[] };
  }
  const { entity, handler } = resolveDefinitions(input.entityType, input.actionKey);
  await assertCanUse(actor, entity, handler);
  const prepared = await parseParams(actor, handler, input.params);
  const sel = await resolveSelection(actor, entity, handler, input.selection);
  if (sel.ids.length === 0) throw new BusinessRuleError("VALIDATION_ERROR", "No records to process: none of the selected records are available to you.", { fieldErrors: { selection: "Nothing selected." } });
  if (handler.confirmation === "type_count" && input.confirmCount !== sel.ids.length) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Type ${sel.ids.length} to confirm this action on ${sel.ids.length} ${entity.pluralLabel.toLowerCase()}.`, { fieldErrors: { confirmCount: "Doesn't match the number of records." }, count: sel.ids.length });
  }

  let job: BulkJob;
  try {
    job = await prisma.$transaction(
      async (tx) => {
        const created = await tx.bulkJob.create({
          data: {
            companyId: actor.companyId,
            entityType: entity.entityType,
            actionKey: handler.key,
            selectionMode: input.selection.mode,
            selection: (input.selection.mode === "FILTER" ? { filterQuery: input.selection.filterQuery, filter: sel.filter, matched: sel.requested } : { requested: sel.requested }) as Prisma.InputJsonValue,
            params: prepared.params as Prisma.InputJsonValue,
            summary: prepared.summary.slice(0, 500),
            totalCount: sel.ids.length,
            idempotencyKey: input.idempotencyKey ?? null,
            requestedByUserId: actor.userId,
          },
        });
        for (let i = 0; i < sel.ids.length; i += 1000) {
          await tx.bulkJobItem.createMany({ data: sel.ids.slice(i, i + 1000).map((entityId, k) => ({ companyId: actor.companyId, jobId: created.id, entityId, sequence: i + k + 1 })) });
        }
        await writeAuditLog(
          { companyId: actor.companyId, userId: actor.userId, tableName: "bulk_jobs", recordId: created.id, action: "CREATE", newValues: { entityType: entity.entityType, actionKey: handler.key, selectionMode: input.selection.mode, totalCount: sel.ids.length, params: prepared.params, summary: prepared.summary } },
          tx
        );
        return created;
      },
      { timeout: 60_000 }
    );
  } catch (e) {
    // Two identical submissions racing: return the one that won.
    if (input.idempotencyKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await prisma.bulkJob.findFirst({ where: { companyId: actor.companyId, requestedByUserId: actor.userId, idempotencyKey: input.idempotencyKey } });
      if (existing) return { ...(await presentJob(existing, actor)), duplicate: true, queued: true, warnings: [] as string[] };
    }
    throw e;
  }
  const queued = await enqueueBulkJob(job.id);
  return { ...(await presentJob(job, actor)), duplicate: false, queued, warnings: [...(prepared.warnings ?? []), ...sel.warnings] };
}

// ── Read ─────────────────────────────────────────────────────────

/** Entity types whose jobs this user may manage for everyone. */
async function adminEntityTypes(actor: BulkActor): Promise<string[]> {
  const out: string[] = [];
  for (const e of listEntities()) if (await PermissionService.can(actor.userId, e.adminPermission.module, e.adminPermission.action)) out.push(e.entityType);
  return out;
}

async function loadJobForActor(actor: BulkActor, id: string): Promise<BulkJob> {
  const job = await prisma.bulkJob.findFirst({ where: { id, companyId: actor.companyId } });
  if (!job) throw new BusinessRuleError("NOT_FOUND", "Bulk job not found.", { id });
  if (job.requestedByUserId === actor.userId) return job;
  const entity = getEntity(job.entityType);
  if (entity && (await PermissionService.can(actor.userId, entity.adminPermission.module, entity.adminPermission.action))) return job;
  throw new BusinessRuleError("NOT_FOUND", "Bulk job not found.", { id });
}

interface ExportFileInfo {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  rowCount: number;
  expiresAt: string;
  storageKey?: string | null;
  deleted?: boolean;
}

function exportFile(job: BulkJob): ExportFileInfo | null {
  const file = (job.result as { file?: ExportFileInfo } | null)?.file;
  return file && typeof file === "object" ? file : null;
}

async function presentJob(job: BulkJob, actor: BulkActor, names?: Map<string, string>) {
  const entity = getEntity(job.entityType);
  const handler = getHandler(job.entityType, job.actionKey);
  const userNames = names ?? new Map((await prisma.user.findMany({ where: { id: { in: [job.requestedByUserId] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const terminal = isTerminalBulkStatus(job.status);
  const file = exportFile(job);
  const expired = file ? file.deleted || new Date(file.expiresAt).getTime() < Date.now() : false;
  const done = job.processedCount;
  return {
    id: job.id,
    entityType: job.entityType,
    entityLabel: entity?.pluralLabel ?? job.entityType,
    listHref: entity?.listHref ?? null,
    actionKey: job.actionKey,
    actionLabel: handler?.label ?? job.actionKey,
    kind: handler?.kind ?? null,
    status: job.status,
    statusLabel: BULK_JOB_STATUSES[job.status].label,
    statusTone: BULK_JOB_STATUSES[job.status].tone,
    selectionMode: job.selectionMode,
    summary: job.summary,
    totalCount: job.totalCount,
    processedCount: done,
    succeededCount: job.succeededCount,
    failedCount: job.failedCount,
    skippedCount: job.skippedCount,
    progress: job.totalCount ? Math.min(100, Math.round((done / job.totalCount) * 100)) : 0,
    error: job.errorCode || job.errorMessage ? { code: job.errorCode, message: job.errorMessage } : null,
    requestedBy: { id: job.requestedByUserId, name: userNames.get(job.requestedByUserId) ?? null },
    isMine: job.requestedByUserId === actor.userId,
    retryOfJobId: job.retryOfJobId,
    canCancel: !terminal && job.status !== "CANCEL_REQUESTED" && (handler?.cancellable ?? true),
    canRetry: terminal && job.failedCount > 0 && Boolean(handler && !handler.unavailableReason),
    download: file ? { fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, rowCount: file.rowCount, expiresAt: file.expiresAt, expired, available: !expired && job.requestedByUserId === actor.userId } : null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    cancelRequestedAt: job.cancelRequestedAt,
    updatedAt: job.updatedAt,
  };
}
export type BulkJobDto = Awaited<ReturnType<typeof presentJob>>;

export async function listBulkJobs(actor: BulkActor, filters: BulkJobFilters, query: ListQuery) {
  const adminTypes = filters.mine ? [] : await adminEntityTypes(actor);
  const where: Prisma.BulkJobWhereInput = {
    companyId: actor.companyId,
    OR: [{ requestedByUserId: actor.userId }, ...(adminTypes.length ? [{ entityType: { in: adminTypes } }] : [])],
    ...(filters.statuses?.length ? { status: { in: filters.statuses as BulkJobStatus[] } } : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(query.search ? { summary: { contains: query.search.slice(0, 100), mode: "insensitive" as const } } : {}),
  };
  const [rows, totalCount] = await Promise.all([prisma.bulkJob.findMany({ where, orderBy: { createdAt: "desc" }, skip: query.skip, take: query.take }), prisma.bulkJob.count({ where })]);
  const names = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.requestedByUserId))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  return { data: await Promise.all(rows.map((r) => presentJob(r, actor, names))), totalCount };
}

export async function getBulkJob(actor: BulkActor, id: string) {
  const job = await loadJobForActor(actor, id);
  const [dto, retries, itemCounts] = await Promise.all([
    presentJob(job, actor),
    prisma.bulkJob.findMany({ where: { retryOfJobId: id, companyId: actor.companyId }, select: { id: true, status: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.bulkJobItem.groupBy({ by: ["status"], where: { jobId: id }, _count: { _all: true } }),
  ]);
  const handler = getHandler(job.entityType, job.actionKey);
  return {
    ...dto,
    selection: job.selectionMode === "FILTER" ? { filterQuery: (job.selection as { filterQuery?: string }).filterQuery ?? "" } : null,
    params: job.params,
    retries: retries.map((r) => ({ id: r.id, status: r.status, statusLabel: BULK_JOB_STATUSES[r.status].label, createdAt: r.createdAt })),
    itemCounts: Object.fromEntries(itemCounts.map((g) => [g.status, g._count._all])) as Partial<Record<BulkJobItemStatus, number>>,
    action: handler ? { destructive: Boolean(handler.destructive), retrySafe: handler.retrySafe, description: handler.description } : null,
  };
}

export async function listBulkJobItems(actor: BulkActor, id: string, filters: { statuses?: BulkJobItemStatus[] }, query: ListQuery) {
  const job = await loadJobForActor(actor, id);
  const entity = getEntity(job.entityType);
  const where: Prisma.BulkJobItemWhereInput = { jobId: id, ...(filters.statuses?.length ? { status: { in: filters.statuses } } : {}) };
  const [rows, totalCount] = await Promise.all([prisma.bulkJobItem.findMany({ where, orderBy: { sequence: "asc" }, skip: query.skip, take: query.take }), prisma.bulkJobItem.count({ where })]);
  const labels = entity ? await entity.recordLabels(job.companyId, rows.map((r) => r.entityId)) : new Map<string, string>();
  return {
    data: rows.map((r) => ({
      id: r.id,
      sequence: r.sequence,
      entityId: r.entityId,
      label: labels.get(r.entityId) ?? "Deleted record",
      href: entity && labels.has(r.entityId) ? entity.recordHref(r.entityId) : null,
      status: r.status,
      statusLabel: BULK_ITEM_STATUSES[r.status],
      message: r.message,
      errorCode: r.errorCode,
      attempts: r.attempts,
      processedAt: r.processedAt,
    })),
    totalCount,
  };
}

// ── Cancel / retry ───────────────────────────────────────────────

/**
 * Cancel stops records that haven't started; it never undoes records already
 * processed. A job not yet picked up is cancelled at once; a running job is
 * marked CANCEL_REQUESTED and stops after the record in progress.
 */
export async function cancelBulkJob(actor: BulkActor, id: string) {
  const job = await loadJobForActor(actor, id);
  const handler = getHandler(job.entityType, job.actionKey);
  if (isTerminalBulkStatus(job.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This job is already ${BULK_JOB_STATUSES[job.status].label.toLowerCase()}.`);
  if (job.status === "CANCEL_REQUESTED") return getBulkJob(actor, id);
  if (handler && !handler.cancellable) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This job can't be cancelled once started.");
  const now = new Date();
  // Not picked up by a worker yet (no live lease): cancel immediately.
  const immediate = await prisma.bulkJob.updateMany({ where: { id, status: "QUEUED", lockToken: null }, data: { status: "CANCELLED", cancelRequestedAt: now, cancelRequestedBy: actor.userId, finishedAt: now } });
  if (immediate.count === 1) {
    await prisma.bulkJobItem.updateMany({ where: { jobId: id, status: "PENDING" }, data: { status: "CANCELLED", message: "Cancelled before this record was processed.", processedAt: now } });
    await refreshBulkCounters(id);
  } else {
    await prisma.bulkJob.updateMany({ where: { id, status: { in: ["QUEUED", "VALIDATING", "RUNNING"] } }, data: { status: "CANCEL_REQUESTED", cancelRequestedAt: now, cancelRequestedBy: actor.userId } });
    // If no worker is alive the recovery tick finishes the cancellation.
    await enqueueBulkJob(id);
  }
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "bulk_jobs", recordId: id, action: "CANCEL", oldValues: { status: job.status }, newValues: { cancelRequested: true, immediate: immediate.count === 1 } });
  return getBulkJob(actor, id);
}

/**
 * Retries the FAILED records of a finished job as a new job (linked by
 * retryOfJobId) so the original report stays as it was. Only one retry per job:
 * asking again returns the existing retry. Records are re-checked by the
 * service layer as usual, so a record fixed in the meantime simply succeeds.
 */
export async function retryBulkJob(actor: BulkActor, id: string, raw: unknown) {
  const input = retryBulkJobSchema.parse(raw ?? {});
  const job = await loadJobForActor(actor, id);
  if (!isTerminalBulkStatus(job.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Wait until the job has finished before retrying it.");
  const existing = await prisma.bulkJob.findFirst({ where: { retryOfJobId: id, companyId: actor.companyId }, orderBy: { createdAt: "desc" } });
  if (existing) return { ...(await presentJob(existing, actor)), duplicate: true, queued: true, warnings: [] as string[] };
  const { entity, handler } = resolveDefinitions(job.entityType, job.actionKey);
  await assertCanUse(actor, entity, handler);
  const failed = await prisma.bulkJobItem.findMany({ where: { jobId: id, status: "FAILED" }, orderBy: { sequence: "asc" }, select: { entityId: true } });
  if (!failed.length) throw new BusinessRuleError("VALIDATION_ERROR", "This job has no failed records to retry.");
  const prepared = await parseParams(actor, handler, job.params);
  // Visibility is re-checked for the person retrying.
  const visible = await entity.visibleIds(actor, failed.map((f) => f.entityId));
  const ids = failed.map((f) => f.entityId).filter((x) => visible.has(x));
  if (!ids.length) throw new BusinessRuleError("VALIDATION_ERROR", "None of the failed records are available to you any more.");
  const created = await prisma.$transaction(async (tx) => {
    const j = await tx.bulkJob.create({
      data: {
        companyId: actor.companyId,
        entityType: job.entityType,
        actionKey: job.actionKey,
        selectionMode: "IDS",
        selection: { retryOf: id, rootJobId: (job.selection as { rootJobId?: string } | null)?.rootJobId ?? id, requested: ids.length } as Prisma.InputJsonValue,
        params: prepared.params as Prisma.InputJsonValue,
        summary: `Retry of failed records · ${prepared.summary}`.slice(0, 500),
        totalCount: ids.length,
        idempotencyKey: input.idempotencyKey ?? `retry:${id}`,
        requestedByUserId: actor.userId,
        retryOfJobId: id,
      },
    });
    for (let i = 0; i < ids.length; i += 1000) {
      await tx.bulkJobItem.createMany({ data: ids.slice(i, i + 1000).map((entityId, k) => ({ companyId: actor.companyId, jobId: j.id, entityId, sequence: i + k + 1 })) });
    }
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "bulk_jobs", recordId: j.id, action: "CREATE", newValues: { retryOf: id, actionKey: job.actionKey, totalCount: ids.length } }, tx);
    return j;
  });
  const queued = await enqueueBulkJob(created.id);
  return { ...(await presentJob(created, actor)), duplicate: false, queued, warnings: [] as string[] };
}

// ── Reports & downloads ──────────────────────────────────────────

/** CSV of every record that failed or was skipped, with the reason (formula-safe). */
export async function buildBulkErrorReport(actor: BulkActor, id: string) {
  const job = await loadJobForActor(actor, id);
  const entity = getEntity(job.entityType);
  const items = await prisma.bulkJobItem.findMany({ where: { jobId: id, status: { in: ["FAILED", "SKIPPED", "CANCELLED"] } }, orderBy: { sequence: "asc" }, take: BULK_ABSOLUTE_MAX_ITEMS });
  const labels = entity ? await entity.recordLabels(job.companyId, items.map((i) => i.entityId)) : new Map<string, string>();
  const rows = items.map((i) => [i.sequence, labels.get(i.entityId) ?? "Deleted record", i.entityId, BULK_ITEM_STATUSES[i.status], i.errorCode ?? "", i.message ?? "", i.attempts, i.processedAt ?? null].map(sanitizeSpreadsheetCell));
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "bulk_jobs", recordId: id, action: "UPDATE", newValues: { downloaded: "error-report", rows: rows.length } });
  return { fileName: `bulk-job-${id.slice(0, 8)}-errors.csv`, buffer: buildSafeCsv(["#", "Record", "Record id", "Outcome", "Error code", "Reason", "Attempts", "Processed at"], rows) };
}

/**
 * The export file of an export job. Only the user who ran the export may
 * download it (it can contain data other admins shouldn't receive by link),
 * only while they still hold the export permission, and only until it expires.
 */
export async function downloadBulkExport(actor: BulkActor, id: string) {
  const job = await loadJobForActor(actor, id);
  const file = exportFile(job);
  if (!file) throw new BusinessRuleError("NOT_FOUND", "This job has no file to download.");
  if (job.requestedByUserId !== actor.userId) throw new BusinessRuleError("PERMISSION_DENIED", "Only the person who ran this export can download it.");
  const handler = getHandler(job.entityType, job.actionKey);
  if (handler) {
    for (const p of handler.permissions) await PermissionService.assert(actor.userId, p.module, p.action);
  }
  if (file.deleted || !file.storageKey || new Date(file.expiresAt).getTime() < Date.now()) throw new BusinessRuleError("NOT_FOUND", "This export has expired. Run the export again.");
  const buffer = await readStoredFile(file.storageKey);
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "bulk_jobs", recordId: id, action: "UPDATE", newValues: { downloaded: file.fileName, rows: file.rowCount } });
  return { fileName: file.fileName, mimeType: file.mimeType, buffer };
}
