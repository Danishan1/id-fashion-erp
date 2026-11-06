import { Prisma, type BulkJobSchedule } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import "./bulk-registrations";
import { isTerminalBulkStatus, SCHEDULE_MAX_FAILURES } from "./bulk-engine";
import { BULK_JOB_STATUSES } from "./bulk-job.schema";
import { adminEntityTypes, assertCanUse, createBulkJob, parseParams, resolveDefinitions } from "./bulk-jobs.service";
import { getEntity, getHandler } from "./bulk-registry";
import { describeSchedule, nextScheduleRunAt, SCHEDULE_TIMEZONE, type ScheduleRule } from "./bulk-schedule-time";
import type { BulkActor } from "./bulk-types";

/**
 * Phase 14 (Sales & Marketing) — saved bulk-job schedules.
 *
 * A schedule is "run this registered, schedulable action over this saved list
 * filter, daily / weekly / monthly at HH:MM India time". Each run is an
 * ordinary bulk job (createBulkJob) started AS THE OWNER: the same permission,
 * availability, parameter and visibility checks apply at every run, records
 * are resolved from the filter at run time, and the job shows on the jobs page
 * with a link back to its schedule.
 *
 *   - No overlap: a run is skipped (and recorded) while the previous job is still going.
 *   - Failures: the owner is notified; after SCHEDULE_MAX_FAILURES failures in a
 *     row the schedule pauses itself.
 *   - Pause / resume / delete (archive) by the owner or an admin of the record type.
 *   - Everything is audited (bulk_job_schedules).
 */

const MAX_SCHEDULES_PER_COMPANY = 50;
const TABLE = "bulk_job_schedules";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");
const ruleFields = {
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  timeOfDay: time,
  dayOfWeek: z.coerce.number().int().min(1).max(7).optional().nullable(),
  dayOfMonth: z.coerce.number().int().min(1, "1–28").max(28, "Up to 28, so every month has the day").optional().nullable(),
};
function checkRule(v: { frequency: string; dayOfWeek?: number | null; dayOfMonth?: number | null }, ctx: z.RefinementCtx) {
  if (v.frequency === "WEEKLY" && !v.dayOfWeek) ctx.addIssue({ code: "custom", path: ["dayOfWeek"], message: "Choose a day of the week." });
  if (v.frequency === "MONTHLY" && !v.dayOfMonth) ctx.addIssue({ code: "custom", path: ["dayOfMonth"], message: "Choose a day of the month." });
}

export const scheduleCreateSchema = z
  .object({
    name: z.string().trim().min(3, "Give the schedule a name").max(120),
    entityType: z.string().trim().min(1).max(40),
    actionKey: z.string().trim().min(1).max(80),
    filterQuery: z.string().max(4000).default(""),
    params: z.record(z.string(), z.unknown()).default({}),
    ...ruleFields,
  })
  .strict()
  .superRefine(checkRule);

export const scheduleUpdateSchema = z
  .object({
    version: z.coerce.number().int(),
    name: z.string().trim().min(3).max(120),
    params: z.record(z.string(), z.unknown()).default({}),
    ...ruleFields,
  })
  .strict()
  .superRefine(checkRule);

export const scheduleActionSchema = z.object({ action: z.enum(["pause", "resume", "delete"]), version: z.coerce.number().int() }).strict();

export const scheduleListSchema = z.object({ entityTypes: z.array(z.string().max(40)).max(20).optional(), includePaused: z.boolean().optional() }).strict();

function ruleOf(s: Pick<BulkJobSchedule, "frequency" | "timeOfDay" | "dayOfWeek" | "dayOfMonth">): ScheduleRule {
  return { frequency: s.frequency, timeOfDay: s.timeOfDay, dayOfWeek: s.dayOfWeek, dayOfMonth: s.dayOfMonth };
}

const normaliseRule = (v: z.infer<z.ZodObject<typeof ruleFields>>) => ({
  frequency: v.frequency,
  timeOfDay: v.timeOfDay,
  dayOfWeek: v.frequency === "WEEKLY" ? (v.dayOfWeek ?? null) : null,
  dayOfMonth: v.frequency === "MONTHLY" ? (v.dayOfMonth ?? null) : null,
});

/** The handler must be registered, schedulable, usable by the actor, and the filter readable. */
async function checkScheduleTarget(actor: BulkActor, entityType: string, actionKey: string, filterQuery: string, params: Record<string, unknown>) {
  const { entity, handler } = resolveDefinitions(entityType, actionKey);
  if (!handler.schedulable) throw new BusinessRuleError("VALIDATION_ERROR", `"${handler.label}" can't be scheduled. Only exports and recalculations can.`, { fieldErrors: { actionKey: "Not schedulable." } });
  await assertCanUse(actor, entity, handler);
  try {
    entity.parseFilterQuery(filterQuery);
  } catch {
    throw new BusinessRuleError("VALIDATION_ERROR", "The list filters couldn't be read. Reload the list and try again.", { fieldErrors: { filterQuery: "Invalid filter." } });
  }
  const prepared = await parseParams(actor, handler, params);
  return { entity, handler, prepared };
}

async function canManage(actor: BulkActor, s: BulkJobSchedule) {
  if (s.ownerUserId === actor.userId) return true;
  const entity = getEntity(s.entityType);
  return Boolean(entity && (await PermissionService.can(actor.userId, entity.adminPermission.module, entity.adminPermission.action)));
}

async function loadForActor(actor: BulkActor, id: string) {
  const s = await prisma.bulkJobSchedule.findFirst({ where: { id, companyId: actor.companyId, archivedAt: null } });
  if (!s || !(await canManage(actor, s))) throw new BusinessRuleError("NOT_FOUND", "Schedule not found.", { id });
  return s;
}

function present(s: BulkJobSchedule, names: Map<string, string>, lastJob?: { status: keyof typeof BULK_JOB_STATUSES } | null) {
  const entity = getEntity(s.entityType);
  const handler = getHandler(s.entityType, s.actionKey);
  return {
    id: s.id,
    name: s.name,
    entityType: s.entityType,
    entityLabel: entity?.pluralLabel ?? s.entityType,
    listHref: entity?.listHref ?? null,
    actionKey: s.actionKey,
    actionLabel: handler?.label ?? s.actionKey,
    available: Boolean(handler?.schedulable),
    filterQuery: s.filterQuery,
    params: s.params,
    summary: s.summary,
    frequency: s.frequency,
    timeOfDay: s.timeOfDay,
    dayOfWeek: s.dayOfWeek,
    dayOfMonth: s.dayOfMonth,
    timezone: s.timezone,
    when: describeSchedule(ruleOf(s)),
    status: s.status,
    nextRunAt: s.nextRunAt,
    lastRunAt: s.lastRunAt,
    lastJobId: s.lastJobId,
    lastJobStatus: lastJob ? { status: lastJob.status, label: BULK_JOB_STATUSES[lastJob.status].label, tone: BULK_JOB_STATUSES[lastJob.status].tone } : null,
    lastOutcome: s.lastOutcome,
    lastMessage: s.lastMessage,
    consecutiveFailures: s.consecutiveFailures,
    owner: { id: s.ownerUserId, name: names.get(s.ownerUserId) ?? null },
    version: s.version,
    createdAt: s.createdAt,
  };
}
export type BulkScheduleDto = ReturnType<typeof present>;

async function presentMany(rows: BulkJobSchedule[]) {
  const [users, jobs] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.ownerUserId))] } }, select: { id: true, fullName: true } }),
    prisma.bulkJob.findMany({ where: { id: { in: rows.map((r) => r.lastJobId).filter((x): x is string => Boolean(x)) } }, select: { id: true, status: true } }),
  ]);
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  const jobStatus = new Map(jobs.map((j) => [j.id, j]));
  return rows.map((r) => present(r, names, r.lastJobId ? jobStatus.get(r.lastJobId) : null));
}

// ── Read ─────────────────────────────────────────────────────────

/** Own schedules, plus every schedule of the record types the user administers. */
export async function listBulkSchedules(actor: BulkActor, raw: unknown) {
  const f = scheduleListSchema.parse(raw ?? {});
  const adminTypes = await adminEntityTypes(actor);
  const rows = await prisma.bulkJobSchedule.findMany({
    where: {
      companyId: actor.companyId,
      archivedAt: null,
      OR: [{ ownerUserId: actor.userId }, ...(adminTypes.length ? [{ entityType: { in: adminTypes } }] : [])],
      ...(f.entityTypes?.length ? { entityType: { in: f.entityTypes } } : {}),
    },
    orderBy: [{ status: "asc" }, { nextRunAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return presentMany(rows);
}

export async function getBulkSchedule(actor: BulkActor, id: string) {
  return (await presentMany([await loadForActor(actor, id)]))[0];
}

// ── Write ────────────────────────────────────────────────────────

export async function createBulkSchedule(actor: BulkActor, raw: unknown, now = new Date()) {
  const input = scheduleCreateSchema.parse(raw);
  const { entity, handler, prepared } = await checkScheduleTarget(actor, input.entityType, input.actionKey, input.filterQuery, input.params);
  const count = await prisma.bulkJobSchedule.count({ where: { companyId: actor.companyId, archivedAt: null } });
  if (count >= MAX_SCHEDULES_PER_COMPANY) throw new BusinessRuleError("VALIDATION_ERROR", `Your company already has ${count} schedules — the most allowed is ${MAX_SCHEDULES_PER_COMPANY}. Delete one you no longer need.`);
  const rule = normaliseRule(input);
  const s = await prisma.$transaction(async (tx) => {
    const created = await tx.bulkJobSchedule.create({
      data: {
        companyId: actor.companyId,
        name: input.name,
        entityType: entity.entityType,
        actionKey: handler.key,
        filterQuery: input.filterQuery,
        params: prepared.params as Prisma.InputJsonValue,
        summary: prepared.summary.slice(0, 500),
        ...rule,
        timezone: SCHEDULE_TIMEZONE,
        nextRunAt: nextScheduleRunAt(rule, now),
        ownerUserId: actor.userId,
        createdByUserId: actor.userId,
      },
    });
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: created.id, action: "CREATE", newValues: { name: input.name, entityType: entity.entityType, actionKey: handler.key, filterQuery: input.filterQuery, params: prepared.params, ...rule } }, tx);
    return created;
  });
  return getBulkSchedule(actor, s.id);
}

export async function updateBulkSchedule(actor: BulkActor, id: string, raw: unknown, now = new Date()) {
  const input = scheduleUpdateSchema.parse(raw);
  const s = await loadForActor(actor, id);
  // Re-checked as the schedule's owner — runs happen as the owner.
  const owner = await ownerActor(s);
  if (!owner) throw new BusinessRuleError("VALIDATION_ERROR", "The schedule's owner is no longer active. Delete it and create a new one.");
  const { prepared } = await checkScheduleTarget(owner, s.entityType, s.actionKey, s.filterQuery, input.params);
  const rule = normaliseRule(input);
  const { count } = await prisma.bulkJobSchedule.updateMany({
    where: { id: s.id, version: input.version, archivedAt: null },
    data: {
      name: input.name,
      params: prepared.params as Prisma.InputJsonValue,
      summary: prepared.summary.slice(0, 500),
      ...rule,
      nextRunAt: s.status === "ACTIVE" ? nextScheduleRunAt(rule, now) : null,
      updatedByUserId: actor.userId,
      version: { increment: 1 },
    },
  });
  if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This schedule changed just now. Reload and try again.");
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: s.id, action: "UPDATE", oldValues: { name: s.name, params: s.params, ...ruleOf(s) }, newValues: { name: input.name, params: prepared.params, ...rule } });
  return getBulkSchedule(actor, s.id);
}

/** Pause (no more runs), resume (next run computed from now, failure count reset), delete (archived; past jobs stay). */
export async function bulkScheduleAction(actor: BulkActor, id: string, raw: unknown, now = new Date()) {
  const input = scheduleActionSchema.parse(raw);
  const s = await loadForActor(actor, id);
  let data: Prisma.BulkJobScheduleUpdateManyMutationInput;
  if (input.action === "pause") {
    if (s.status === "PAUSED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This schedule is already paused.");
    data = { status: "PAUSED", nextRunAt: null };
  } else if (input.action === "resume") {
    if (s.status === "ACTIVE") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This schedule is already active.");
    const owner = await ownerActor(s);
    if (!owner) throw new BusinessRuleError("VALIDATION_ERROR", "The schedule's owner is no longer active. Delete it and create a new one.");
    await checkScheduleTarget(owner, s.entityType, s.actionKey, s.filterQuery, s.params as Record<string, unknown>);
    data = { status: "ACTIVE", nextRunAt: nextScheduleRunAt(ruleOf(s), now), consecutiveFailures: 0 };
  } else {
    data = { status: "PAUSED", nextRunAt: null, archivedAt: now };
  }
  const { count } = await prisma.bulkJobSchedule.updateMany({ where: { id: s.id, version: input.version, archivedAt: null }, data: { ...data, updatedByUserId: actor.userId, version: { increment: 1 } } });
  if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This schedule changed just now. Reload and try again.");
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: s.id, action: input.action === "delete" ? "DELETE" : "UPDATE", oldValues: { status: s.status }, newValues: { action: input.action } });
  return input.action === "delete" ? { id: s.id, deleted: true as const } : getBulkSchedule(actor, s.id);
}

// ── Runner (worker tick) ─────────────────────────────────────────

async function ownerActor(s: Pick<BulkJobSchedule, "companyId" | "ownerUserId">): Promise<BulkActor | null> {
  const u = await prisma.user.findFirst({ where: { id: s.ownerUserId, companyId: s.companyId, status: "ACTIVE" }, select: { id: true, defaultBranchId: true } });
  return u ? { companyId: s.companyId, userId: u.id, branchId: u.defaultBranchId ?? null } : null;
}

async function startFailed(s: BulkJobSchedule, message: string) {
  const failures = s.consecutiveFailures + 1;
  const pause = failures >= SCHEDULE_MAX_FAILURES;
  await prisma.bulkJobSchedule.update({
    where: { id: s.id },
    data: { lastOutcome: "FAILED_TO_START", lastMessage: message.slice(0, 500), consecutiveFailures: failures, ...(pause ? { status: "PAUSED", nextRunAt: null } : {}) },
  });
  await writeAuditLog({ companyId: s.companyId, userId: s.ownerUserId, tableName: TABLE, recordId: s.id, action: "UPDATE", newValues: { run: "FAILED_TO_START", message, ...(pause ? { status: "PAUSED" } : {}) } });
  await createNotification({
    companyId: s.companyId,
    userId: s.ownerUserId,
    title: (pause ? `Schedule paused: ${s.name}` : `Scheduled job couldn't start: ${s.name}`).slice(0, 200),
    body: (pause ? `It failed ${failures} times in a row. Fix the cause and resume it. ` : "") + message,
  }).catch(() => undefined);
}

export interface ScheduleTickResult {
  started: string[];
  skipped: string[];
  failed: string[];
}

/**
 * Worker tick (every minute): starts every active schedule that is due. A
 * schedule is claimed by moving its nextRunAt forward with a guarded update,
 * so two workers (or a retried tick) never start the same run twice; the
 * job's idempotency key `sched:<id>:<due time>` is a second guard.
 */
export async function runDueBulkSchedules(now: Date = new Date()): Promise<ScheduleTickResult> {
  const out: ScheduleTickResult = { started: [], skipped: [], failed: [] };
  const due = await prisma.bulkJobSchedule.findMany({ where: { status: "ACTIVE", archivedAt: null, nextRunAt: { lte: now } }, orderBy: { nextRunAt: "asc" }, take: 20 });
  for (const s of due) {
    const dueAt = s.nextRunAt!;
    const claimed = await prisma.bulkJobSchedule.updateMany({
      where: { id: s.id, status: "ACTIVE", nextRunAt: dueAt, version: s.version },
      // Missed runs (worker down) are not replayed one by one: the next run is computed from now.
      data: { nextRunAt: nextScheduleRunAt(ruleOf(s), now), lastRunAt: now },
    });
    if (claimed.count === 0) continue;

    if (s.lastJobId) {
      const last = await prisma.bulkJob.findUnique({ where: { id: s.lastJobId }, select: { status: true } });
      if (last && !isTerminalBulkStatus(last.status)) {
        await prisma.bulkJobSchedule.update({ where: { id: s.id }, data: { lastOutcome: "SKIPPED_OVERLAP", lastMessage: "Skipped: the previous run was still going." } });
        await writeAuditLog({ companyId: s.companyId, userId: s.ownerUserId, tableName: TABLE, recordId: s.id, action: "UPDATE", newValues: { run: "SKIPPED_OVERLAP", previousJobId: s.lastJobId } });
        out.skipped.push(s.id);
        continue;
      }
    }

    const actor = await ownerActor(s);
    if (!actor) {
      await startFailed(s, "The schedule's owner is no longer an active user.");
      out.failed.push(s.id);
      continue;
    }
    const handler = getHandler(s.entityType, s.actionKey);
    if (!handler?.schedulable) {
      await startFailed(s, "This action can no longer be scheduled.");
      out.failed.push(s.id);
      continue;
    }
    try {
      const job = await createBulkJob(
        actor,
        { entityType: s.entityType, actionKey: s.actionKey, selection: { mode: "FILTER", filterQuery: s.filterQuery }, params: s.params as Record<string, unknown>, idempotencyKey: `sched:${s.id}:${dueAt.toISOString()}` },
        { scheduleId: s.id }
      );
      await prisma.bulkJobSchedule.update({ where: { id: s.id }, data: { lastJobId: job.id, lastOutcome: "STARTED", lastMessage: `Started on ${job.totalCount} record(s).` } });
      out.started.push(s.id);
    } catch (e) {
      // Nothing matching the filter right now is not a failure of the schedule.
      if (e instanceof BusinessRuleError && e.details?.empty) {
        await prisma.bulkJobSchedule.update({ where: { id: s.id }, data: { lastOutcome: "NOTHING_TO_DO", lastMessage: "No records matched the saved filter.", consecutiveFailures: 0 } });
        out.skipped.push(s.id);
        continue;
      }
      const message = e instanceof BusinessRuleError ? e.message : "The job couldn't be created (unexpected error).";
      if (!(e instanceof BusinessRuleError)) console.error(JSON.stringify({ level: "error", message: "Bulk schedule run failed", scheduleId: s.id, error: (e as Error)?.message }));
      await startFailed(s, message);
      out.failed.push(s.id);
    }
  }
  return out;
}
