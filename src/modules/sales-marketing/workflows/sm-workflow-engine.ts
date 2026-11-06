import { randomUUID } from "node:crypto";
import { Prisma, type RelatedModule, type SmWorkflowInstance } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { runWithRequestContext } from "@/core/logging/requestContext";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { evaluateGroup, type ConditionGroup } from "@/modules/crm/workflows/workflow-conditions";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { readSource, SM_WF_SOURCES } from "./sm-workflow-events";
import {
  canSmWfTransition,
  SM_WF_LIMITS,
  SM_WF_RETRY_DELAYS_MS,
  SM_WF_RUNNABLE,
  SM_WF_SETTINGS_SCHEMAS,
  SM_WORKFLOWS,
  type SmWfEvent,
  type SmWfStatus,
  type SmWorkflowKey,
} from "./sm-workflow-registry";

/**
 * Phase 15 — the S&M workflow orchestrator.
 *
 *  dispatch  committed S&M events (sm-workflow-events.ts) → each counted once
 *            (event log, unique source + key) → start an instance of every
 *            ACTIVE definition it triggers (entry conditions, one live instance
 *            per definition + record) and wake every live instance watching
 *            the record.
 *  run       an instance is claimed with a lease (lock token; stale after 5 min)
 *            and its current step runs; every step leaves a row. Waiting steps
 *            re-check the AUTHORITATIVE record each time (an event only wakes
 *            them early), so a duplicate, late or out-of-order event can't
 *            move a workflow wrongly.
 *  failures  transient errors back off (1 / 5 / 30 min) then FAILED; business
 *            rule errors fail at once; FAILED / NEEDS_ATTENTION wait for a person.
 *
 * Side effects are idempotent across a crash between the action and the
 * checkpoint: CRM tasks by source + external ref, notifications by a key
 * written in the same transaction as the notification.
 */

// ── Step contract ────────────────────────────────────────────────

export type StepResult =
  | { type: "next"; goto?: string; summary: string; result?: Record<string, unknown> }
  | { type: "wait"; status: "WAITING_APPROVAL" | "WAITING_EVENT" | "SCHEDULED"; recheckAt: Date; summary: string; result?: Record<string, unknown> }
  | { type: "complete"; outcome: string; summary: string; result?: Record<string, unknown> }
  | { type: "attention"; code: string; summary: string; result?: Record<string, unknown> };

export interface StepCtx<S = Record<string, unknown>> {
  instance: Pick<SmWorkflowInstance, "id" | "companyId" | "entityType" | "entityId" | "correlationId" | "startedAt" | "waitingSince" | "workflowKey">;
  settings: S;
  runAs: SalesActor;
  now: Date;
  /** Instance context (refs recorded on the way); changes are saved with the step. */
  data: Record<string, unknown>;
  stepKey: string;
  /** Instances watching these keys are woken by their events. */
  watch: (...keys: string[]) => void;
  /** Exactly once per key (written with the notification). Only to users who can view `module`. */
  notify: (key: string, userIds: (string | null | undefined)[], msg: { title: string; body: string; module: string; relatedModule?: RelatedModule; relatedRecordId?: string }) => Promise<number>;
  /** Sends `notify` once, when `afterMs` has passed since the step started waiting. Returns when it is due (for the next check). */
  remindOnce: (key: string, afterMs: number, userIds: (string | null | undefined)[], msg: { title: string; body: string; module: string; relatedModule?: RelatedModule; relatedRecordId?: string }) => Promise<Date | null>;
}

export interface WorkflowImpl {
  key: SmWorkflowKey;
  /** Cheap pre-filter on the event before an instance is created (e.g. only failed jobs). */
  accepts?: (event: SmWfEvent, settings: Record<string, unknown>) => boolean;
  /** The flat snapshot the definition's conditions are evaluated on (allow-listed keys only). */
  snapshot: (companyId: string, entityType: string, entityId: string, event: SmWfEvent | null) => Promise<Record<string, unknown> | null>;
  label: (companyId: string, entityType: string, entityId: string) => Promise<string | null>;
  steps: Record<string, (ctx: StepCtx) => Promise<StepResult>>;
  /** Compensation on cancel: undo what is safely undoable (e.g. cancel open tasks it created). */
  compensate?: (ctx: StepCtx) => Promise<string>;
}

const impls = new Map<SmWorkflowKey, WorkflowImpl>();
export function registerWorkflowImpl(impl: WorkflowImpl) {
  impls.set(impl.key, impl);
}
export function getWorkflowImpl(key: string) {
  return impls.get(key as SmWorkflowKey) ?? null;
}

// ── Helpers ──────────────────────────────────────────────────────

const RUNNABLE = [...SM_WF_RUNNABLE] as string[];
const TRANSIENT_CODES = new Set(["RECORD_VERSION_CONFLICT", "RATE_LIMITED", "REQUEST_IN_PROGRESS"]);
const TRANSIENT_PRISMA = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2028", "P2034"]);

export function classifyError(e: unknown): { transient: boolean; code: string; message: string } {
  if (e instanceof BusinessRuleError) return { transient: TRANSIENT_CODES.has(e.code), code: e.code, message: e.message.slice(0, 500) };
  if (e instanceof Prisma.PrismaClientKnownRequestError) return { transient: TRANSIENT_PRISMA.has(e.code), code: `DB_${e.code}`, message: "A database error occurred." };
  if (e instanceof Prisma.PrismaClientInitializationError || e instanceof Prisma.PrismaClientRustPanicError) return { transient: true, code: "DB_UNAVAILABLE", message: "The database was not reachable." };
  if (e && typeof e === "object" && (e as { name?: string }).name === "ZodError") return { transient: false, code: "VALIDATION_ERROR", message: "The workflow's settings or a record are not valid." };
  // Unknown errors (network, timeouts) are retried a few times before failing.
  return { transient: true, code: "UNEXPECTED", message: "Unexpected error — see the server log." };
}

async function auditInstance(i: { id: string; companyId: string }, userId: string, action: "CREATE" | "UPDATE" | "CANCEL", newValues: Record<string, unknown>, oldValues?: Record<string, unknown>) {
  await writeAuditLog({ companyId: i.companyId, userId, tableName: "sm_workflow_instances", recordId: i.id, action, newValues, oldValues }).catch(() => undefined);
}

/** Is the run-as user still active and holding every permission the workflow needs? */
export async function runAsProblem(key: SmWorkflowKey, companyId: string, userId: string | null, settings: Record<string, unknown>): Promise<string | null> {
  if (!userId) return "The workflow has no run-as user. Activate it again.";
  const u = await prisma.user.findFirst({ where: { id: userId, companyId, status: "ACTIVE" }, select: { id: true } });
  if (!u) return "The user the workflow runs as is no longer active. Activate it again as an active user.";
  const def = SM_WORKFLOWS[key];
  const perms = [...def.requiredPermissions, ...(settings.createTask ? (def.taskPermissions ?? []) : [])];
  for (const p of perms) {
    if (!(await PermissionService.can(userId, p.module as never, p.action as never))) return `The user the workflow runs as no longer has ${p.module}.${p.action}.`;
  }
  return null;
}

/** Users who may receive a message about a record of `module` (active, same company, can view it). */
export async function eligibleRecipients(companyId: string, userIds: (string | null | undefined)[], module: string): Promise<string[]> {
  const ids = [...new Set(userIds.filter((x): x is string => Boolean(x)))];
  if (!ids.length) return [];
  const active = await prisma.user.findMany({ where: { id: { in: ids }, companyId, status: "ACTIVE" }, select: { id: true } });
  const out: string[] = [];
  for (const u of active) if (await PermissionService.can(u.id, module as never, "view" as never)) out.push(u.id);
  return out;
}

// ── Starting instances ───────────────────────────────────────────

type ActiveDefinition = Prisma.SmWorkflowDefinitionGetPayload<{ include: { activeVersion: true } }>;

export async function startInstance(
  def: ActiveDefinition,
  entity: { entityType: string; entityId: string },
  trigger: { source: "EVENT" | "MANUAL"; eventKey: string | null; userId: string | null; event: SmWfEvent | null },
  now: Date = new Date()
): Promise<{ instance: SmWorkflowInstance; created: boolean }> {
  const impl = getWorkflowImpl(def.workflowKey);
  if (!impl || !def.activeVersion) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This workflow is not active.");
  const live = await prisma.smWorkflowInstance.findFirst({ where: { definitionId: def.id, entityType: entity.entityType, entityId: entity.entityId, status: { notIn: ["COMPLETED", "CANCELLED"] } } });
  if (live) return { instance: live, created: false };
  const id = randomUUID();
  const firstStep = SM_WORKFLOWS[def.workflowKey as SmWorkflowKey].steps[0].key;
  const idempotencyKey = trigger.eventKey ? `evt:${trigger.eventKey}:${def.id}` : `manual:${def.id}:${entity.entityType}:${entity.entityId}:${now.getTime()}`;
  try {
    const instance = await prisma.smWorkflowInstance.create({
      data: {
        id,
        companyId: def.companyId,
        definitionId: def.id,
        versionId: def.activeVersion.id,
        workflowKey: def.workflowKey,
        entityType: entity.entityType,
        entityId: entity.entityId,
        entityLabel: await impl.label(def.companyId, entity.entityType, entity.entityId).catch(() => null),
        status: "RUNNING",
        currentStep: firstStep,
        nextRunAt: now,
        triggerSource: trigger.source,
        triggerEventKey: trigger.eventKey,
        correlationId: `smwf:${id}`,
        idempotencyKey,
        initiatedByUserId: trigger.userId,
        watchKeys: [`${entity.entityType}:${entity.entityId}`],
        context: (trigger.event ? { trigger: { type: trigger.event.type, at: trigger.event.occurredAt.toISOString(), data: trigger.event.data } } : { trigger: { type: "manual", at: now.toISOString() } }) as Prisma.InputJsonValue,
      },
    });
    await auditInstance(instance, trigger.userId ?? def.runAsUserId ?? instance.id, "CREATE", { workflowKey: def.workflowKey, version: def.activeVersion.versionNumber, entityType: entity.entityType, entityId: entity.entityId, trigger: trigger.source, eventKey: trigger.eventKey });
    return { instance, created: true };
  } catch (e) {
    // Same event twice, or a concurrent start for the same record: the existing one wins.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await prisma.smWorkflowInstance.findFirst({
        where: { OR: [{ companyId: def.companyId, idempotencyKey }, { definitionId: def.id, entityType: entity.entityType, entityId: entity.entityId, status: { notIn: ["COMPLETED", "CANCELLED"] } }] },
        orderBy: { createdAt: "desc" },
      });
      if (existing) return { instance: existing, created: false };
    }
    throw e;
  }
}

/** Entry conditions of the active version on the record (+ the event). Missing data = condition not met (never an error). */
export async function entryMatches(def: ActiveDefinition, entity: { entityType: string; entityId: string }, event: SmWfEvent | null, now: Date) {
  const impl = getWorkflowImpl(def.workflowKey);
  if (!impl || !def.activeVersion) return false;
  const settings = SM_WF_SETTINGS_SCHEMAS[def.workflowKey as SmWorkflowKey].parse(def.activeVersion.settings ?? {}) as Record<string, unknown>;
  if (event && impl.accepts && !impl.accepts(event, settings)) return false;
  const group = (def.activeVersion.conditions as { entry?: ConditionGroup } | null)?.entry;
  if (!group || !group.conditions?.length) return true;
  const snap = await impl.snapshot(def.companyId, entity.entityType, entity.entityId, event);
  if (!snap) return false;
  return evaluateGroup(group, snap, now);
}

// ── Dispatcher ───────────────────────────────────────────────────

export interface DispatchResult {
  read: number;
  started: number;
  woken: number;
  invalid: number;
}

/** Wakes live instances watching any of the keys (next check now). */
async function wake(companyId: string, keys: string[], now: Date) {
  if (!keys.length) return 0;
  const r = await prisma.smWorkflowInstance.updateMany({
    where: { companyId, status: { in: ["WAITING_APPROVAL", "WAITING_EVENT", "SCHEDULED"] }, watchKeys: { hasSome: keys } },
    data: { nextRunAt: now },
  });
  return r.count;
}

export async function dispatchEvents(now: Date = new Date()): Promise<DispatchResult> {
  const out: DispatchResult = { read: 0, started: 0, woken: 0, invalid: 0 };
  const defsByCompany = new Map<string, ActiveDefinition[]>();
  const activeDefs = async (companyId: string) => {
    if (!defsByCompany.has(companyId)) defsByCompany.set(companyId, await prisma.smWorkflowDefinition.findMany({ where: { companyId, status: "ACTIVE" }, include: { activeVersion: true } }));
    return defsByCompany.get(companyId)!;
  };
  for (const source of SM_WF_SOURCES) {
    const batch = await readSource(source, now);
    for (const bad of batch.invalid) {
      const ins = await prisma.smWorkflowEventLog.createMany({
        data: [{ companyId: bad.companyId, source: source.name, sourceKey: bad.sourceKey, eventType: "invalid", entityType: "UNKNOWN", entityId: bad.companyId, occurredAt: now, status: "INVALID" }],
        skipDuplicates: true,
      });
      if (ins.count) {
        out.invalid++;
        console.error(JSON.stringify({ level: "warn", message: "S&M workflow event rejected", source: source.name, sourceKey: bad.sourceKey, reason: bad.reason }));
      }
    }
    for (const ev of batch.events) {
      // Claim the event once (a re-read of the overlap, or a second worker, skips it).
      const claim = await prisma.smWorkflowEventLog.createMany({
        data: [{ companyId: ev.companyId, source: ev.source, sourceKey: ev.sourceKey, eventType: ev.type, entityType: ev.entityType, entityId: ev.entityId, occurredAt: ev.occurredAt, status: "PROCESSED" }],
        skipDuplicates: true,
      });
      if (!claim.count) continue;
      out.read++;
      let started = 0;
      for (const def of await activeDefs(ev.companyId)) {
        const wf = SM_WORKFLOWS[def.workflowKey as SmWorkflowKey];
        if (!wf || !wf.triggers.includes(ev.type) || !def.activeVersion) continue;
        // Events from before the version was activated never start it.
        if (def.activeVersion.activatedAt && ev.occurredAt < def.activeVersion.activatedAt) continue;
        try {
          if (!(await entryMatches(def, ev, ev, now))) continue;
          const r = await startInstance(def, ev, { source: "EVENT", eventKey: `${ev.source}:${ev.sourceKey}`, userId: null, event: ev }, now);
          if (r.created) started++;
        } catch (e) {
          console.error(JSON.stringify({ level: "error", message: "S&M workflow start failed", workflowKey: def.workflowKey, source: ev.source, sourceKey: ev.sourceKey, error: (e as Error).message }));
        }
      }
      const woken = await wake(ev.companyId, ev.keys, now);
      out.started += started;
      out.woken += woken;
      if (started || woken) await prisma.smWorkflowEventLog.update({ where: { source_sourceKey: { source: ev.source, sourceKey: ev.sourceKey } }, data: { startedInstances: started, wokenInstances: woken } });
    }
    if (batch.maxSeen) await prisma.smWorkflowCheckpoint.upsert({ where: { source: source.name }, create: { source: source.name, lastSeenAt: batch.maxSeen }, update: { lastSeenAt: batch.maxSeen } });
  }
  return out;
}

// ── Executor ─────────────────────────────────────────────────────

async function claim(id: string, now: Date) {
  const token = randomUUID();
  const stale = new Date(now.getTime() - SM_WF_LIMITS.lockMs);
  const r = await prisma.smWorkflowInstance.updateMany({
    where: {
      id,
      status: { in: RUNNABLE },
      OR: [{ lockToken: null }, { lockedAt: { lt: stale } }],
      AND: [{ OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] }],
    },
    data: { lockToken: token, lockedAt: now },
  });
  return r.count ? token : null;
}

async function transition(i: SmWorkflowInstance, token: string, to: SmWfStatus, data: Prisma.SmWorkflowInstanceUncheckedUpdateManyInput) {
  if (!canSmWfTransition(i.status as SmWfStatus, to)) throw new Error(`Illegal workflow transition ${i.status} → ${to}`);
  const r = await prisma.smWorkflowInstance.updateMany({ where: { id: i.id, lockToken: token, status: i.status }, data: { ...data, status: to } });
  if (!r.count) throw new Error("Workflow instance changed while running (lease lost).");
}

/** The last step row, reused while the same WAIT step keeps checking (no row per check). */
async function stepRow(i: SmWorkflowInstance, stepKey: string, kind: string, attempt: number, runAs: string | null, now: Date) {
  const last = await prisma.smWorkflowStepRun.findFirst({ where: { instanceId: i.id }, orderBy: { sequence: "desc" } });
  if (last && last.stepKey === stepKey && (last.status === "WAITING" || last.status === "RUNNING")) {
    return prisma.smWorkflowStepRun.update({ where: { id: last.id }, data: { status: "RUNNING", checks: { increment: 1 }, lastCheckAt: now, attempt } });
  }
  return prisma.smWorkflowStepRun.create({ data: { companyId: i.companyId, instanceId: i.id, sequence: (last?.sequence ?? 0) + 1, stepKey, kind, status: "RUNNING", attempt, checks: 1, actorUserId: runAs, lastCheckAt: now, startedAt: now } });
}

export interface RunOptions {
  now?: Date;
  /** Test hook: throws after a step's action, before its checkpoint (crash simulation). */
  crashAfterStep?: string;
}

/**
 * Runs one instance until it waits, completes, needs a person or fails.
 * Returns the final status, or null when it wasn't due / is held by another worker.
 */
export async function runInstance(id: string, opts: RunOptions = {}): Promise<SmWfStatus | null> {
  const now = opts.now ?? new Date();
  const token = await claim(id, now);
  if (!token) return null;
  let i = await prisma.smWorkflowInstance.findUniqueOrThrow({ where: { id }, include: { definition: true, version: true } });
  const release = () => prisma.smWorkflowInstance.updateMany({ where: { id, lockToken: token }, data: { lockToken: null, lockedAt: null } });
  const key = i.workflowKey as SmWorkflowKey;
  const impl = getWorkflowImpl(key);
  const wf = SM_WORKFLOWS[key];
  if (!impl || !wf) {
    await prisma.smWorkflowInstance.updateMany({ where: { id, lockToken: token }, data: { status: "FAILED", nextRunAt: null, errorCode: "UNKNOWN_WORKFLOW", errorMessage: "This workflow type is no longer available.", lockToken: null, lockedAt: null } });
    return "FAILED";
  }
  if (i.status !== "RUNNING") {
    await transition(i, token, "RUNNING", {});
    i = { ...i, status: "RUNNING" };
  }
  const settings = SM_WF_SETTINGS_SCHEMAS[key].parse(i.version.settings ?? {}) as Record<string, unknown>;
  const runAsId = i.definition.runAsUserId;
  const runAs: SalesActor = { companyId: i.companyId, userId: runAsId ?? "", branchId: null };
  let data = (i.context ?? {}) as Record<string, unknown>;
  const watchKeys = new Set(i.watchKeys);

  try {
    for (let n = 0; n < SM_WF_LIMITS.stepsPerPass; n++) {
      const stepKey = i.currentStep;
      const step = impl.steps[stepKey];
      const stepDef = wf.steps.find((s) => s.key === stepKey);
      if (!step || !stepDef) throw new BusinessRuleError("VALIDATION_ERROR", `Unknown step "${stepKey}".`);
      const problem = await runAsProblem(key, i.companyId, runAsId, settings);
      if (problem) {
        await prisma.smWorkflowStepRun.create({ data: { companyId: i.companyId, instanceId: i.id, sequence: ((await prisma.smWorkflowStepRun.findFirst({ where: { instanceId: i.id }, orderBy: { sequence: "desc" } }))?.sequence ?? 0) + 1, stepKey, kind: stepDef.kind, status: "FAILED", errorCode: "RUN_AS_INVALID", errorMessage: problem, finishedAt: now } });
        await transition(i, token, "NEEDS_ATTENTION", { errorCode: "RUN_AS_INVALID", errorMessage: problem, nextRunAt: null, context: data as Prisma.InputJsonValue });
        await auditInstance(i, runAsId ?? i.id, "UPDATE", { status: "NEEDS_ATTENTION", errorCode: "RUN_AS_INVALID", step: stepKey });
        await release();
        return "NEEDS_ATTENTION";
      }
      const row = await stepRow(i, stepKey, stepDef.kind, i.attempts + 1, runAsId, now);
      const ctx: StepCtx = {
        instance: i,
        settings,
        runAs,
        now,
        data,
        stepKey,
        watch: (...keys) => keys.forEach((k) => watchKeys.add(k)),
        notify: async (nKey, userIds, msg) => {
          // Build on ctx.data: the step may have added to it (tasks, ids) before notifying.
          const cur = ctx.data;
          const sent = (cur.sent ?? {}) as Record<string, string>;
          const full = `${stepKey}:${nKey}`;
          if (sent[full]) return 0;
          const to = await eligibleRecipients(i.companyId, userIds, msg.module);
          const next = { ...cur, sent: { ...sent, [full]: now.toISOString() } };
          await prisma.$transaction(async (tx) => {
            for (const userId of to) await createNotification({ companyId: i.companyId, userId, title: msg.title.slice(0, 200), body: msg.body.slice(0, 1000), relatedModule: msg.relatedModule, relatedRecordId: msg.relatedRecordId }, tx);
            // The key is saved with the notifications: a crash can't make it send twice.
            await tx.smWorkflowInstance.update({ where: { id: i.id }, data: { context: next as Prisma.InputJsonValue } });
          });
          data = next;
          ctx.data = data;
          return to.length;
        },
        remindOnce: async (nKey, afterMs, userIds, msg) => {
          const since = (i.waitingSince ?? row.startedAt).getTime();
          const due = new Date(since + afterMs);
          if (due > now) return due;
          await ctx.notify(nKey, userIds, msg);
          return null;
        },
      };
      const result = await runWithRequestContext({ requestId: i.correlationId, userId: runAsId ?? undefined, companyId: i.companyId }, () => step(ctx));
      data = ctx.data;
      if (opts.crashAfterStep === stepKey) throw Object.assign(new Error("simulated crash"), { simulatedCrash: true });

      const ctxData = { ...data } as Prisma.InputJsonValue;
      const watch = [...watchKeys];
      if (result.type === "wait") {
        await prisma.smWorkflowStepRun.update({ where: { id: row.id }, data: { status: "WAITING", summary: result.summary.slice(0, 500), result: (result.result ?? Prisma.JsonNull) as Prisma.InputJsonValue } });
        await transition(i, token, result.status, { nextRunAt: result.recheckAt, waitingSince: i.waitingSince ?? now, attempts: 0, context: ctxData, watchKeys: watch, errorCode: null, errorMessage: null });
        await release();
        return result.status;
      }
      await prisma.smWorkflowStepRun.update({
        where: { id: row.id },
        data: { status: result.type === "attention" ? "FAILED" : "DONE", summary: result.summary.slice(0, 500), result: (result.result ?? Prisma.JsonNull) as Prisma.InputJsonValue, finishedAt: now, ...(result.type === "attention" ? { errorCode: result.code, errorMessage: result.summary.slice(0, 500) } : {}) },
      });
      if (result.type === "complete") {
        await transition(i, token, "COMPLETED", { outcome: result.outcome, outcomeMessage: result.summary.slice(0, 500), completedAt: now, nextRunAt: null, waitingSince: null, attempts: 0, context: ctxData, watchKeys: watch, errorCode: null, errorMessage: null });
        await auditInstance(i, runAsId ?? i.id, "UPDATE", { status: "COMPLETED", outcome: result.outcome });
        await release();
        return "COMPLETED";
      }
      if (result.type === "attention") {
        await transition(i, token, "NEEDS_ATTENTION", { errorCode: result.code, errorMessage: result.summary.slice(0, 500), nextRunAt: null, context: ctxData, watchKeys: watch });
        await auditInstance(i, runAsId ?? i.id, "UPDATE", { status: "NEEDS_ATTENTION", errorCode: result.code, step: stepKey });
        await release();
        return "NEEDS_ATTENTION";
      }
      // next
      const idx = wf.steps.findIndex((s) => s.key === stepKey);
      const nextKey = result.goto ?? wf.steps[idx + 1]?.key;
      if (!nextKey) throw new BusinessRuleError("VALIDATION_ERROR", `Step "${stepKey}" has no next step.`);
      await transition(i, token, "RUNNING", { currentStep: nextKey, waitingSince: null, attempts: 0, nextRunAt: now, context: ctxData, watchKeys: watch });
      i = { ...i, currentStep: nextKey, waitingSince: null, attempts: 0, context: ctxData as Prisma.JsonValue, watchKeys: watch };
    }
    // Step budget used up: continue on the next tick.
    await release();
    return "RUNNING";
  } catch (e) {
    if ((e as { simulatedCrash?: boolean }).simulatedCrash) throw e; // test: the lease is left behind, like a dead worker
    const err = classifyError(e);
    if (err.code === "UNEXPECTED") console.error(JSON.stringify({ level: "error", message: "S&M workflow step failed", instanceId: i.id, step: i.currentStep, error: (e as Error)?.message, stack: (e as Error)?.stack }));
    const last = await prisma.smWorkflowStepRun.findFirst({ where: { instanceId: i.id }, orderBy: { sequence: "desc" } });
    if (last && last.stepKey === i.currentStep && last.status === "RUNNING") await prisma.smWorkflowStepRun.update({ where: { id: last.id }, data: { status: "FAILED", errorCode: err.code, errorMessage: err.message, finishedAt: now } });
    const attempts = i.attempts + 1;
    const fresh = await prisma.smWorkflowInstance.findUnique({ where: { id: i.id } });
    if (!fresh || fresh.lockToken !== token) return null;
    if (err.transient && attempts <= SM_WF_RETRY_DELAYS_MS.length) {
      await transition(fresh, token, "RETRY_PENDING", { attempts, nextRunAt: new Date(now.getTime() + SM_WF_RETRY_DELAYS_MS[attempts - 1]), errorCode: err.code, errorMessage: err.message, context: data as Prisma.InputJsonValue });
      await release();
      return "RETRY_PENDING";
    }
    await transition(fresh, token, "FAILED", { attempts, nextRunAt: null, errorCode: err.code, errorMessage: err.message, context: data as Prisma.InputJsonValue });
    await auditInstance(fresh, runAsId ?? fresh.id, "UPDATE", { status: "FAILED", errorCode: err.code, step: fresh.currentStep });
    await release();
    return "FAILED";
  }
}

/** Instances that are due (and not leased by a live worker). */
export async function runDueInstances(now: Date = new Date(), limit: number = SM_WF_LIMITS.dueBatch) {
  const stale = new Date(now.getTime() - SM_WF_LIMITS.lockMs);
  const due = await prisma.smWorkflowInstance.findMany({
    where: { status: { in: RUNNABLE }, OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }], AND: [{ OR: [{ lockToken: null }, { lockedAt: { lt: stale } }] }] },
    orderBy: { nextRunAt: "asc" },
    take: limit,
    select: { id: true },
  });
  const results: Record<string, number> = {};
  for (const d of due) {
    const s = await runInstance(d.id, { now }).catch((e) => {
      console.error(JSON.stringify({ level: "error", message: "S&M workflow run crashed", instanceId: d.id, error: (e as Error).message }));
      return null;
    });
    if (s) results[s] = (results[s] ?? 0) + 1;
  }
  return results;
}

/** The worker tick: dispatch events, run what is due, tidy the event log. */
export async function tickSmWorkflows(now: Date = new Date()) {
  const dispatched = await dispatchEvents(now);
  const ran = await runDueInstances(now);
  const purged = await prisma.smWorkflowEventLog.deleteMany({ where: { processedAt: { lt: new Date(now.getTime() - SM_WF_LIMITS.eventLogRetentionDays * 86_400_000) } } });
  return { ...dispatched, ran, purgedEvents: purged.count };
}

// ── Operator actions (used by the service layer, permission-checked there) ──

export async function operatorTransition(i: SmWorkflowInstance, to: SmWfStatus, data: Prisma.SmWorkflowInstanceUncheckedUpdateManyInput) {
  if (!canSmWfTransition(i.status as SmWfStatus, to)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `A workflow that is ${i.status.toLowerCase().replace(/_/g, " ")} can't go to ${to.toLowerCase().replace(/_/g, " ")}.`);
  const stale = new Date(Date.now() - SM_WF_LIMITS.lockMs);
  // Never while a worker is running it (the change would race the step).
  const r = await prisma.smWorkflowInstance.updateMany({ where: { id: i.id, status: i.status, OR: [{ lockToken: null }, { lockedAt: { lt: stale } }] }, data: { ...data, status: to, lockToken: null, lockedAt: null } });
  if (!r.count) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "The workflow is running or changed just now. Try again in a moment.");
}

/** Builds a step context for compensation (cancel) — no notifications, only the compensate hook. */
export async function compensateInstance(i: SmWorkflowInstance): Promise<{ status: "NONE" | "DONE" | "FAILED"; summary: string }> {
  const impl = getWorkflowImpl(i.workflowKey);
  if (!impl?.compensate) return { status: "NONE", summary: "Nothing to undo." };
  const def = await prisma.smWorkflowDefinition.findUniqueOrThrow({ where: { id: i.definitionId } });
  const version = await prisma.smWorkflowDefinitionVersion.findUniqueOrThrow({ where: { id: i.versionId } });
  const settings = SM_WF_SETTINGS_SCHEMAS[i.workflowKey as SmWorkflowKey].parse(version.settings ?? {}) as Record<string, unknown>;
  const ctx: StepCtx = {
    instance: i,
    settings,
    runAs: { companyId: i.companyId, userId: def.runAsUserId ?? "", branchId: null },
    now: new Date(),
    data: (i.context ?? {}) as Record<string, unknown>,
    stepKey: "compensate",
    watch: () => undefined,
    notify: async () => 0,
    remindOnce: async () => null,
  };
  try {
    const summary = await runWithRequestContext({ requestId: i.correlationId, userId: def.runAsUserId ?? undefined, companyId: i.companyId }, () => impl.compensate!(ctx));
    return { status: "DONE", summary };
  } catch (e) {
    return { status: "FAILED", summary: classifyError(e).message };
  }
}
