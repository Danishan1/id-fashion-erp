import { randomUUID } from "node:crypto";
import { Prisma, type BulkJobStatus } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { deleteStoredFile } from "@/core/file-storage/FileStorage";
import "./bulk-registrations";
import { actionAvailability, getEntity, getHandler } from "./bulk-registry";
import { toSafeItemError } from "./bulk-safety";
import type { BulkActor, BulkItemOutcome } from "./bulk-types";

/**
 * Phase 14 — the bulk job processor. Called by the worker for a queue message;
 * also callable directly (tests, recovery). Safe to call concurrently for the
 * same job: only the holder of the Postgres lease processes it.
 *
 *   QUEUED → VALIDATING (requester still active, still permitted, action still
 *   available, parameters still valid) → RUNNING (items in batches) →
 *   COMPLETED | COMPLETED_WITH_ERRORS | FAILED, or CANCELLED after a cancel request.
 *
 * Per record: PENDING → PROCESSING → SUCCEEDED | SKIPPED | FAILED (| CANCELLED).
 * A record is processed in its own service call (its own transaction), so one
 * failing record never rolls back the others — and nothing already done is
 * rolled back on cancel (cancel stops what hasn't started).
 */

export const BULK_LEASE_MS = 3 * 60_000;
export const BULK_BATCH_SIZE = 50;
const TERMINAL: BulkJobStatus[] = ["CANCELLED", "COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED"];
export const isTerminalBulkStatus = (s: BulkJobStatus) => TERMINAL.includes(s);

type ClaimedJob = Prisma.BulkJobGetPayload<object>;

async function claim(jobId: string, now: Date): Promise<{ job: ClaimedJob; token: string } | null> {
  const token = randomUUID();
  const staleBefore = new Date(now.getTime() - BULK_LEASE_MS);
  const claimed = await prisma.bulkJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["QUEUED", "VALIDATING", "RUNNING", "CANCEL_REQUESTED"] },
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
    },
    data: { lockToken: token, lockedAt: now, runCount: { increment: 1 } },
  });
  if (claimed.count === 0) return null;
  const job = await prisma.bulkJob.findUniqueOrThrow({ where: { id: jobId } });
  return { job, token };
}

/** Extends the lease; false when another worker took the job over (stop immediately). */
async function renew(jobId: string, token: string): Promise<boolean> {
  const r = await prisma.bulkJob.updateMany({ where: { id: jobId, lockToken: token }, data: { lockedAt: new Date() } });
  return r.count === 1;
}

export async function refreshBulkCounters(jobId: string) {
  const groups = await prisma.bulkJobItem.groupBy({ by: ["status"], where: { jobId }, _count: { _all: true } });
  const n = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
  const succeeded = n("SUCCEEDED");
  const failed = n("FAILED");
  const skipped = n("SKIPPED");
  const counts = { succeededCount: succeeded, failedCount: failed, skippedCount: skipped, processedCount: succeeded + failed + skipped };
  await prisma.bulkJob.update({ where: { id: jobId }, data: counts });
  return { ...counts, cancelled: n("CANCELLED"), pending: n("PENDING") + n("PROCESSING") };
}

async function finish(job: ClaimedJob, token: string, status: BulkJobStatus, extra: Prisma.BulkJobUpdateManyMutationInput = {}) {
  const counts = await refreshBulkCounters(job.id);
  await prisma.bulkJob.updateMany({ where: { id: job.id, lockToken: token }, data: { status, finishedAt: new Date(), lockToken: null, lockedAt: null, ...extra } });
  await writeAuditLog({
    companyId: job.companyId,
    userId: job.requestedByUserId,
    tableName: "bulk_jobs",
    recordId: job.id,
    action: "UPDATE",
    newValues: { status, actionKey: job.actionKey, entityType: job.entityType, ...counts, errorCode: (extra.errorCode as string | undefined) ?? null },
  });
  const entity = getEntity(job.entityType);
  const handler = getHandler(job.entityType, job.actionKey);
  const what = `${handler?.label ?? job.actionKey} — ${entity?.pluralLabel.toLowerCase() ?? job.entityType}`;
  const title =
    status === "COMPLETED"
      ? `Bulk job finished: ${what}`
      : status === "COMPLETED_WITH_ERRORS"
        ? `Bulk job finished with errors: ${what}`
        : status === "CANCELLED"
          ? `Bulk job cancelled: ${what}`
          : `Bulk job failed: ${what}`;
  const body =
    status === "FAILED" && extra.errorMessage
      ? String(extra.errorMessage)
      : `${counts.succeededCount} succeeded, ${counts.skippedCount} skipped, ${counts.failedCount} failed${counts.cancelled ? `, ${counts.cancelled} not processed` : ""}.`;
  await createNotification({ companyId: job.companyId, userId: job.requestedByUserId, title: title.slice(0, 200), body }).catch(() => undefined);
  return status;
}

async function cancelRemaining(jobId: string, message: string) {
  await prisma.bulkJobItem.updateMany({ where: { jobId, status: "PENDING" }, data: { status: "CANCELLED", message, processedAt: new Date() } });
}

async function loadActor(job: ClaimedJob): Promise<BulkActor | null> {
  const user = await prisma.user.findFirst({ where: { id: job.requestedByUserId, companyId: job.companyId, status: "ACTIVE" }, select: { id: true, defaultBranchId: true } });
  return user ? { companyId: job.companyId, userId: user.id, branchId: user.defaultBranchId ?? null } : null;
}

async function recordOutcome(jobId: string, itemId: string, outcome: BulkItemOutcome | Error) {
  if (outcome instanceof Error) {
    const err = toSafeItemError(outcome);
    if (err.unexpected) console.error(JSON.stringify({ level: "error", message: "Bulk item failed unexpectedly", bulkJobId: jobId, itemId, error: outcome.message, stack: outcome.stack }));
    await prisma.bulkJobItem.update({ where: { id: itemId }, data: { status: "FAILED", errorCode: err.code, message: err.message, processedAt: new Date() } });
    return;
  }
  await prisma.bulkJobItem.update({
    where: { id: itemId },
    data: { status: outcome.status, message: outcome.message?.slice(0, 500) ?? null, errorCode: null, result: (outcome.result as Prisma.InputJsonValue) ?? Prisma.JsonNull, processedAt: new Date() },
  });
}

export interface ProcessOptions {
  batchSize?: number;
  now?: Date;
  /** Test hook: called after each batch (e.g. to request cancellation mid-run). */
  afterBatch?: (processed: number) => Promise<void>;
}

/**
 * Processes a bulk job to the end (or until cancelled / the lease is lost).
 * Returns the final status, or null when the job wasn't claimable (finished,
 * or another worker holds a live lease).
 */
export async function processBulkJob(jobId: string, opts: ProcessOptions = {}): Promise<BulkJobStatus | null> {
  const got = await claim(jobId, opts.now ?? new Date());
  if (!got) return null;
  const { token } = got;
  let job = got.job;
  const handler = getHandler(job.entityType, job.actionKey);
  const entity = getEntity(job.entityType);

  if (job.status === "CANCEL_REQUESTED") {
    await cancelRemaining(job.id, "Cancelled before this record was processed.");
    return finish(job, token, "CANCELLED");
  }
  if (!handler || !entity || (!handler.executeItem && !handler.executeBatch)) {
    await cancelRemaining(job.id, "Not processed: the job failed.");
    return finish(job, token, "FAILED", { errorCode: "BULK_ACTION_UNKNOWN", errorMessage: "This bulk action is no longer available." });
  }

  // ── VALIDATING: re-check everything that may have changed since submit ──
  if (job.status === "QUEUED" || job.status === "VALIDATING") {
    await prisma.bulkJob.updateMany({ where: { id: job.id, lockToken: token }, data: { status: "VALIDATING", startedAt: job.startedAt ?? new Date() } });
  }
  const actor = await loadActor(job);
  const fail = async (code: string, message: string) => {
    await cancelRemaining(job.id, "Not processed: the job failed.");
    return finish(job, token, "FAILED", { errorCode: code, errorMessage: message });
  };
  if (!actor) return fail("REQUESTER_INACTIVE", "The user who started this job is no longer active.");
  if (!(await PermissionService.can(actor.userId, entity.viewPermission.module, entity.viewPermission.action))) return fail("PERMISSION_DENIED", "The user who started this job can no longer see these records.");
  const av = await actionAvailability(actor, handler);
  if (!av.available) return fail("BULK_ACTION_UNAVAILABLE", av.reason ?? "This action is no longer available.");
  let params: Record<string, unknown>;
  try {
    const parsed = handler.paramsSchema.parse(job.params ?? {});
    params = handler.prepare ? (await handler.prepare(actor, parsed)).params : parsed;
  } catch (e) {
    const err = toSafeItemError(e);
    if (err.unexpected) console.error(JSON.stringify({ level: "error", message: "Bulk job validation crashed", bulkJobId: job.id, error: (e as Error)?.message }));
    return fail(err.code, `The job's settings are no longer valid: ${err.message}`);
  }

  // Items left PROCESSING by a crashed run: re-run if safe, otherwise report as unknown.
  if (handler.retrySafe) {
    await prisma.bulkJobItem.updateMany({ where: { jobId: job.id, status: "PROCESSING" }, data: { status: "PENDING" } });
  } else {
    await prisma.bulkJobItem.updateMany({
      where: { jobId: job.id, status: "PROCESSING" },
      data: { status: "FAILED", errorCode: "OUTCOME_UNKNOWN", message: "Processing was interrupted; this record may or may not have been changed. Check it before retrying.", processedAt: new Date() },
    });
  }

  await prisma.bulkJob.updateMany({ where: { id: job.id, lockToken: token, status: { in: ["VALIDATING", "QUEUED"] } }, data: { status: "RUNNING" } });

  // ── RUNNING ──
  const batchSize = opts.batchSize ?? BULK_BATCH_SIZE;
  const ctxJob = { id: job.id, companyId: job.companyId, entityType: job.entityType, actionKey: job.actionKey };
  // Retries of a job share the original's idempotency keys, so a record whose outcome
  // was unknown (crash mid-send) can never produce a second message on retry.
  const rootJobId = (job.selection as { rootJobId?: string } | null)?.rootJobId ?? job.id;
  let processed = 0;
  for (;;) {
    const current = await prisma.bulkJob.findUnique({ where: { id: job.id }, select: { status: true, lockToken: true } });
    if (!current || current.lockToken !== token) return null; // lease lost
    if (current.status === "CANCEL_REQUESTED") {
      await cancelRemaining(job.id, "Cancelled before this record was processed.");
      return finish(job, token, "CANCELLED");
    }
    if (!(await renew(job.id, token))) return null;

    const batch = await prisma.bulkJobItem.findMany({ where: { jobId: job.id, status: "PENDING" }, orderBy: { sequence: "asc" }, take: batchSize });
    if (batch.length === 0) break;

    if (handler.executeBatch) {
      const ids = batch.map((b) => b.id);
      await prisma.bulkJobItem.updateMany({ where: { id: { in: ids }, status: "PENDING" }, data: { status: "PROCESSING", attempts: { increment: 1 } } });
      let outcomes: Map<string, BulkItemOutcome | Error>;
      try {
        outcomes = await handler.executeBatch({ actor, job: ctxJob, items: batch.map((b) => ({ id: b.id, entityId: b.entityId, sequence: b.sequence, attempt: b.attempts + 1 })), params });
      } catch (e) {
        outcomes = new Map(ids.map((id) => [id, e instanceof Error ? e : new Error(String(e))]));
      }
      for (const item of batch) await recordOutcome(job.id, item.id, outcomes.get(item.id) ?? new Error("No outcome was reported for this record."));
      processed += batch.length;
      await refreshBulkCounters(job.id);
      if (opts.afterBatch) await opts.afterBatch(processed);
      continue;
    }

    for (const item of batch) {
      // Slow actions (sends) keep the lease fresh between records.
      if (processed > 0 && processed % 10 === 0 && !(await renew(job.id, token))) return null;
      const started = await prisma.bulkJobItem.updateMany({ where: { id: item.id, status: "PENDING" }, data: { status: "PROCESSING", attempts: { increment: 1 } } });
      if (started.count === 0) continue;
      try {
        const outcome = await handler.executeItem!({
          actor,
          job: ctxJob,
          item: { id: item.id, entityId: item.entityId, sequence: item.sequence, attempt: item.attempts + 1 },
          params,
          idempotencyKey: `bulk:${rootJobId}:${item.entityId}`,
        });
        await recordOutcome(job.id, item.id, outcome);
      } catch (e) {
        await recordOutcome(job.id, item.id, e instanceof Error ? e : new Error(String(e)));
      }
      processed++;
    }
    await refreshBulkCounters(job.id);
    if (opts.afterBatch) await opts.afterBatch(processed);
  }

  // ── Finalize (e.g. write the export file) ──
  job = await prisma.bulkJob.findUniqueOrThrow({ where: { id: job.id } });
  let result: Record<string, unknown> | null = null;
  if (handler.finalize) {
    try {
      result = await handler.finalize({ actor, job: { ...ctxJob, createdAt: job.createdAt }, params });
    } catch (e) {
      const err = toSafeItemError(e);
      if (err.unexpected) console.error(JSON.stringify({ level: "error", message: "Bulk job finalize failed", bulkJobId: job.id, error: (e as Error)?.message, stack: (e as Error)?.stack }));
      return finish(job, token, "FAILED", { errorCode: err.code, errorMessage: err.unexpected ? "The job's output could not be produced. Try again later." : err.message });
    }
  }
  const counts = await refreshBulkCounters(job.id);
  const status: BulkJobStatus = counts.failedCount === 0 ? "COMPLETED" : counts.succeededCount + counts.skippedCount === 0 ? "FAILED" : "COMPLETED_WITH_ERRORS";
  return finish(job, token, status, {
    ...(result ? { result: result as Prisma.InputJsonValue } : {}),
    ...(status === "FAILED" ? { errorCode: "ALL_ITEMS_FAILED", errorMessage: "None of the records could be processed. See the error report." } : {}),
  });
}

/**
 * Recovery tick (worker, every minute): finds jobs that should be making
 * progress but aren't — QUEUED with no queue message processed, or RUNNING /
 * VALIDATING / CANCEL_REQUESTED with an expired lease (worker crashed or was
 * restarted) — and processes them again. Also deletes expired export files.
 */
export async function recoverBulkJobs(now: Date = new Date(), enqueue?: (id: string) => Promise<boolean>): Promise<{ resumed: string[]; expiredFiles: number }> {
  const queuedBefore = new Date(now.getTime() - 60_000);
  const staleBefore = new Date(now.getTime() - BULK_LEASE_MS);
  const stalled = await prisma.bulkJob.findMany({
    where: {
      OR: [
        { status: "QUEUED", createdAt: { lt: queuedBefore }, OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }] },
        { status: { in: ["VALIDATING", "RUNNING", "CANCEL_REQUESTED"] }, OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }] },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  const resumed: string[] = [];
  for (const j of stalled) {
    if (enqueue && (await enqueue(j.id))) resumed.push(j.id);
    else if (!enqueue) {
      await processBulkJob(j.id, { now });
      resumed.push(j.id);
    }
  }
  const expiredFiles = await purgeExpiredExports(now);
  return { resumed, expiredFiles };
}

/** Export files are kept for a limited time (result.expiresAt); afterwards the file is deleted and the link stops working. */
export async function purgeExpiredExports(now: Date = new Date()): Promise<number> {
  const due = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM bulk_jobs
    WHERE result -> 'file' ->> 'storageKey' IS NOT NULL
      AND (result -> 'file' ->> 'expiresAt')::timestamptz < ${now}
    LIMIT 100`;
  const rows = due.length ? await prisma.bulkJob.findMany({ where: { id: { in: due.map((d) => d.id) } }, select: { id: true, result: true } }) : [];
  let n = 0;
  for (const r of rows) {
    const result = (r.result ?? {}) as { file?: { storageKey?: string } & Record<string, unknown> };
    if (result.file?.storageKey) await deleteStoredFile(result.file.storageKey).catch(() => undefined);
    await prisma.bulkJob.update({ where: { id: r.id }, data: { result: { ...result, file: { ...result.file, storageKey: null, deleted: true } } as Prisma.InputJsonValue } });
    n++;
  }
  return n;
}
