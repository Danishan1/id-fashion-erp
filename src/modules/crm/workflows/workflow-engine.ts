import { randomUUID } from "node:crypto";
import type { CrmEntityType, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { logger } from "@/core/logging/logger";
import { runWithRequestContext } from "@/core/logging/requestContext";
import { PermissionService } from "@/core/rbac/PermissionService";
import { buildCrmEventData } from "../core/crm-events.service";
import { CrmEventRepository } from "../core/crm-event.repository";
import { WORKFLOW_ACTIONS, type WorkflowActionDef, type WorkflowActionKey } from "./workflow-action-catalog";
import { runWorkflowAction, WorkflowActionError } from "./workflow-actions";
import { evaluateGroup, explainGroup } from "./workflow-conditions";
import { buildConditionSnapshot, customFieldDefs, loadRecordSnapshot, type TriggerFacts } from "./workflow-context";
import { availableFields, definitionEntities, workflowDefinitionSchema, type WorkflowDefinition, type WorkflowNode } from "./workflow-definition";
import { WORKFLOW_CORRELATION_PREFIX, WORKFLOW_LIMITS, type ExecutionOutcome } from "./workflow-registry";
import { computeResumeAt, describeWait } from "./workflow-waits";
import { WORKFLOW_TRIGGER_KEYS, WORKFLOW_TRIGGERS, payloadMatches, triggersForEvent, type WorkflowTriggerDef, type WorkflowTriggerKey } from "./workflow-triggers";

/**
 * The workflow execution engine.
 *
 *   dispatchWorkflowEvents  crm_events (the outbox) → new executions. Each
 *                           event is claimed in crm_workflow_event_log in the
 *                           same transaction that creates its executions, and
 *                           executions are unique per (company, "evt:<event>:<workflow>")
 *                           — an event starts each workflow at most once,
 *                           however many workers run it.
 *   runExecution            claims one due execution (atomic status flip with
 *                           a lock token) and walks its graph until it waits,
 *                           finishes, fails, or yields after maxStepsPerRun.
 *   recoverStaleExecutions  RUNNING executions whose worker died: retried when
 *                           the interrupted step is safe to repeat, else failed.
 *   tickWorkflows           all three; run every 15 s by the worker and kicked
 *                           right after commits that write triggering events.
 *
 * Waits are persisted (`next_run_at`), never timers. Actions run as the
 * workflow's run-as user, inside a request context whose correlation id is
 * "wfexec:<executionId>" — events they cause are recognisable, which is how
 * recursion (workflow → change → workflow) is detected and bounded.
 */

type ExecutionRow = Prisma.CrmWorkflowExecutionGetPayload<{ include: { workflow: true; workflowVersion: true } }>;

interface ExecutionContext {
  trigger?: TriggerFacts | null;
  /** Visits per node id (acyclic graphs: 1 each). */
  visits?: Record<string, number>;
  /** Set while a WAIT node is pending. */
  waitingNodeId?: string | null;
  /** Steps that ran in test mode only describe what they would do. */
  test?: boolean;
}

function readContext(row: { context: Prisma.JsonValue }): ExecutionContext {
  return row.context && typeof row.context === "object" && !Array.isArray(row.context) ? (row.context as ExecutionContext) : {};
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

// ── Starting executions ─────────────────────────────────────────

export interface StartExecutionInput {
  companyId: string;
  workflow: { id: string; name: string; runAsUserId: string | null };
  versionId: string;
  triggerType: string;
  entityType: CrmEntityType;
  entityId: string;
  idempotencyKey: string;
  trigger: TriggerFacts | null;
  mode?: "LIVE" | "TEST";
  depth?: number;
  parentExecutionId?: string | null;
  startedByUserId?: string | null;
  runAsUserId?: string | null;
}

/** Creates a QUEUED execution; returns null when one with the same idempotency key already exists. */
export async function createExecution(input: StartExecutionInput, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const id = randomUUID();
  const rows = await db.crmWorkflowExecution.createManyAndReturn({
    data: [
      {
        id,
        companyId: input.companyId,
        workflowId: input.workflow.id,
        workflowVersionId: input.versionId,
        status: "QUEUED",
        mode: input.mode ?? "LIVE",
        triggerType: input.triggerType,
        triggerEventId: input.trigger?.eventId ?? null,
        entityType: input.entityType,
        entityId: input.entityId,
        idempotencyKey: input.idempotencyKey,
        parentExecutionId: input.parentExecutionId ?? null,
        depth: input.depth ?? 0,
        context: json({ trigger: input.trigger, visits: {}, ...(input.mode === "TEST" ? { test: true } : {}) }),
        nextRunAt: new Date(),
        runAsUserId: input.runAsUserId ?? input.workflow.runAsUserId,
        startedByUserId: input.startedByUserId ?? null,
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });
  return rows[0] ?? null;
}

interface PublishedWorkflow {
  id: string;
  name: string;
  companyId: string;
  runAsUserId: string | null;
  publishedAt: Date | null;
  versionId: string;
  definition: WorkflowDefinition;
}

async function loadPublishedWorkflows(): Promise<PublishedWorkflow[]> {
  const rows = await prisma.crmWorkflow.findMany({
    where: { status: "PUBLISHED", publishedVersionId: { not: null }, triggerType: { not: "manual" } },
    select: { id: true, name: true, companyId: true, runAsUserId: true, publishedAt: true, publishedVersion: { select: { id: true, definition: true } } },
  });
  const out: PublishedWorkflow[] = [];
  for (const r of rows) {
    const parsed = workflowDefinitionSchema.safeParse(r.publishedVersion?.definition);
    if (!parsed.success || !r.publishedVersion) continue;
    out.push({ id: r.id, name: r.name, companyId: r.companyId, runAsUserId: r.runAsUserId, publishedAt: r.publishedAt, versionId: r.publishedVersion.id, definition: parsed.data });
  }
  return out;
}

/** Why an event did not start a workflow (counted, logged at debug). */
type SkipReason = "PAYLOAD" | "ENTITY" | "RECURSION" | "DEPTH" | "REENTRY" | "RATE" | "CONDITIONS" | "BEFORE_PUBLISH" | "MISSING_RECORD";

/** Decides whether `event` starts `wf`, and on which record. Pure apart from reads. */
export async function evaluateEventForWorkflow(
  event: { id: string; companyId: string; entityType: CrmEntityType; entityId: string; eventType: string; payload: Prisma.JsonValue; actorUserId: string | null; correlationId: string | null; occurredAt: Date },
  wf: PublishedWorkflow,
  parent: { id: string; workflowId: string; depth: number } | null
): Promise<{ start: true; entityType: CrmEntityType; entityId: string; depth: number; trigger: TriggerFacts; triggerType: WorkflowTriggerKey } | { start: false; reason: SkipReason }> {
  const key = wf.definition.trigger.type as WorkflowTriggerKey;
  const def = WORKFLOW_TRIGGERS[key] as WorkflowTriggerDef | undefined;
  if (!def || !def.events.includes(event.eventType as never)) return { start: false, reason: "PAYLOAD" };
  if (!payloadMatches(def, event.payload)) return { start: false, reason: "PAYLOAD" };
  if (wf.publishedAt && event.occurredAt < wf.publishedAt) return { start: false, reason: "BEFORE_PUBLISH" };
  const entities = definitionEntities(wf.definition);
  if (!entities.includes(event.entityType as never)) return { start: false, reason: "ENTITY" };
  // Recursion protection: events caused by workflow actions.
  if (parent) {
    if (parent.workflowId === wf.id) return { start: false, reason: "RECURSION" };
    if (!wf.definition.settings.allowWorkflowTriggers) return { start: false, reason: "RECURSION" };
    if (parent.depth + 1 > WORKFLOW_LIMITS.maxDepth) return { start: false, reason: "DEPTH" };
  }
  // Re-entry / storm protection.
  const reentry = wf.definition.settings.reentry;
  if (reentry !== "ALWAYS") {
    const where: Prisma.CrmWorkflowExecutionWhereInput = { workflowId: wf.id, entityId: event.entityId, mode: "LIVE", ...(reentry === "AFTER_FINISH" ? { status: { in: ["QUEUED", "RUNNING", "WAITING", "PAUSED"] } } : {}) };
    if (await prisma.crmWorkflowExecution.findFirst({ where, select: { id: true } })) return { start: false, reason: "REENTRY" };
  }
  const recent = await prisma.crmWorkflowExecution.count({ where: { workflowId: wf.id, entityId: event.entityId, mode: "LIVE", createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
  if (recent >= WORKFLOW_LIMITS.maxStartsPerRecordPerHour) return { start: false, reason: "RATE" };
  const trigger: TriggerFacts = {
    eventId: event.id,
    eventType: event.eventType,
    payload: event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? (event.payload as Record<string, unknown>) : {},
    actorUserId: event.actorUserId,
    correlationId: event.correlationId,
    occurredAt: event.occurredAt.toISOString(),
  };
  if (wf.definition.trigger.conditions?.conditions.length) {
    const record = await loadRecordSnapshot(event.companyId, event.entityType, event.entityId);
    if (!record.exists) return { start: false, reason: "MISSING_RECORD" };
    if (!evaluateGroup(wf.definition.trigger.conditions, buildConditionSnapshot(record, trigger))) return { start: false, reason: "CONDITIONS" };
  }
  return { start: true, entityType: event.entityType, entityId: event.entityId, depth: parent ? parent.depth + 1 : 0, trigger, triggerType: key };
}

/**
 * Reads new triggering events from crm_events and starts executions. Safe to
 * run on several workers at once (claim + unique keys). Events older than the
 * look-back window or than a workflow's publish time never start it.
 */
export async function dispatchWorkflowEvents(now: Date = new Date()): Promise<{ events: number; started: number }> {
  const workflows = await loadPublishedWorkflows();
  if (!workflows.length) return { events: 0, started: 0 };
  const companies = [...new Set(workflows.map((w) => w.companyId))];
  const eventTypes = [...new Set(workflows.flatMap((w) => [...((WORKFLOW_TRIGGERS[w.definition.trigger.type as WorkflowTriggerKey] as WorkflowTriggerDef | undefined)?.events ?? [])]))];
  if (!eventTypes.length) return { events: 0, started: 0 };
  const since = new Date(Math.max(now.getTime() - WORKFLOW_LIMITS.dispatchLookbackMs, Math.min(...workflows.map((w) => (w.publishedAt ?? now).getTime()))));
  const events = await prisma.$queryRaw<{ id: string; company_id: string; entity_type: CrmEntityType; entity_id: string; event_type: string; payload: Prisma.JsonValue; actor_user_id: string | null; correlation_id: string | null; occurred_at: Date }[]>`
    SELECT e.id, e.company_id, e.entity_type, e.entity_id, e.event_type, e.payload, e.actor_user_id, e.correlation_id, e.occurred_at
    FROM crm_events e
    WHERE e.occurred_at >= ${since}
      AND e.company_id = ANY(${companies}::uuid[])
      AND e.event_type = ANY(${eventTypes}::text[])
      AND NOT EXISTS (SELECT 1 FROM crm_workflow_event_log l WHERE l.event_id = e.id)
    ORDER BY e.occurred_at, e.id
    LIMIT ${WORKFLOW_LIMITS.dispatchBatch}`;
  let started = 0;
  for (const e of events) {
    const event = { id: e.id, companyId: e.company_id, entityType: e.entity_type, entityId: e.entity_id, eventType: e.event_type, payload: e.payload, actorUserId: e.actor_user_id, correlationId: e.correlation_id, occurredAt: e.occurred_at };
    const candidates = workflows.filter((w) => w.companyId === event.companyId && triggersForEvent(event.eventType).includes(w.definition.trigger.type as WorkflowTriggerKey));
    let parent: { id: string; workflowId: string; depth: number } | null = null;
    if (event.correlationId?.startsWith(WORKFLOW_CORRELATION_PREFIX)) {
      parent = await prisma.crmWorkflowExecution.findUnique({ where: { id: event.correlationId.slice(WORKFLOW_CORRELATION_PREFIX.length) }, select: { id: true, workflowId: true, depth: true } }).catch(() => null);
    }
    const decisions = [];
    for (const wf of candidates) {
      try {
        decisions.push({ wf, d: await evaluateEventForWorkflow(event, wf, parent) });
      } catch (err) {
        logger.error("Workflow trigger evaluation failed", { workflowId: wf.id, eventId: event.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    const toStart = decisions.filter((x) => x.d.start);
    // Claim the event and create its executions atomically.
    const n = await prisma.$transaction(async (tx) => {
      const claimed = await tx.$executeRaw`INSERT INTO crm_workflow_event_log (event_id, company_id, matched, started, processed_at) VALUES (${event.id}::uuid, ${event.companyId}::uuid, ${candidates.length}, ${toStart.length}, ${now}) ON CONFLICT (event_id) DO NOTHING`;
      if (!claimed) return 0;
      let count = 0;
      for (const { wf, d } of toStart) {
        if (!d.start) continue;
        const created = await createExecution(
          {
            companyId: event.companyId,
            workflow: wf,
            versionId: wf.versionId,
            triggerType: d.triggerType,
            entityType: d.entityType,
            entityId: d.entityId,
            idempotencyKey: `evt:${event.id}:${wf.id}`,
            trigger: d.trigger,
            depth: d.depth,
            parentExecutionId: parent?.id ?? null,
          },
          tx
        );
        if (created) {
          count++;
          await tx.crmWorkflow.update({ where: { id: wf.id }, data: { lastTriggeredAt: now } });
        }
      }
      return count;
    });
    started += n;
  }
  return { events: events.length, started };
}

// ── Running executions ──────────────────────────────────────────

async function claim(id: string, now: Date, opts: { force?: boolean } = {}): Promise<string | null> {
  const token = randomUUID();
  const { count } = await prisma.crmWorkflowExecution.updateMany({
    where: { id, status: { in: ["QUEUED", "WAITING"] }, ...(opts.force ? {} : { OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] }) },
    data: { status: "RUNNING", lockedAt: now, lockToken: token },
  });
  return count === 1 ? token : null;
}

function nodeMap(def: WorkflowDefinition): Map<string, WorkflowNode> {
  return new Map(def.nodes.map((n) => [n.id, n]));
}

async function finish(id: string, token: string, status: "COMPLETED" | "FAILED" | "EXITED" | "CANCELLED", outcome: ExecutionOutcome, extra: { exitReason?: string | null; errorCode?: string | null; errorMessage?: string | null; currentNodeId?: string | null } = {}) {
  await prisma.crmWorkflowExecution.updateMany({
    where: { id, lockToken: token },
    data: { status, outcome, finishedAt: new Date(), lockedAt: null, lockToken: null, nextRunAt: null, exitReason: extra.exitReason ?? null, errorCode: extra.errorCode ?? null, errorMessage: extra.errorMessage?.slice(0, 2000) ?? null, ...(extra.currentNodeId !== undefined ? { currentNodeId: extra.currentNodeId } : {}) },
  });
}

async function recordFailureEvent(row: { id: string; companyId: string; workflowId: string; entityType: CrmEntityType | null; entityId: string | null; mode: string }, message: string, code: string | null) {
  if (row.mode !== "LIVE") return;
  try {
    await CrmEventRepository.create(
      buildCrmEventData({ companyId: row.companyId, userId: null }, { entityType: "WORKFLOW", entityId: row.workflowId, eventType: "workflow.execution_failed", summary: message.slice(0, 300), payload: { executionId: row.id, entityType: row.entityType, entityId: row.entityId, errorCode: code } })
    );
  } catch (e) {
    logger.error("Could not record workflow failure event", { executionId: row.id, error: e instanceof Error ? e.message : String(e) });
  }
}

async function nextSequence(executionId: string): Promise<number> {
  const agg = await prisma.crmWorkflowExecutionStep.aggregate({ where: { executionId }, _max: { sequence: true } });
  return (agg._max.sequence ?? 0) + 1;
}

async function writeStep(row: { id: string; companyId: string }, data: { nodeId: string; nodeType: string; actionKey?: string | null; status: string; attempt?: number; idempotencyKey: string; input?: unknown; output?: unknown; branch?: string | null; errorCode?: string | null; errorMessage?: string | null; finished?: boolean }) {
  return prisma.crmWorkflowExecutionStep.create({
    data: {
      companyId: row.companyId,
      executionId: row.id,
      sequence: await nextSequence(row.id),
      nodeId: data.nodeId,
      nodeType: data.nodeType,
      actionKey: data.actionKey ?? null,
      status: data.status,
      attempt: data.attempt ?? 1,
      idempotencyKey: data.idempotencyKey,
      input: data.input === undefined ? undefined : json(data.input),
      output: data.output === undefined ? undefined : json(data.output),
      branch: data.branch ?? null,
      errorCode: data.errorCode ?? null,
      errorMessage: data.errorMessage?.slice(0, 2000) ?? null,
      finishedAt: data.finished === false ? null : new Date(),
    },
  });
}

/** Labels for traces ("Status is …"). */
async function fieldLabels(companyId: string, def: WorkflowDefinition): Promise<Map<string, string>> {
  const entities = definitionEntities(def);
  const custom = entities.length === 1 ? await customFieldDefs(companyId, entities[0]) : [];
  return new Map([...availableFields(def, custom).values()].map((f) => [f.key, f.label]));
}

export interface RunResult {
  executionId: string;
  status: string;
  steps: number;
}

/**
 * Walks one execution forward. Returns null when it was not due / already
 * claimed elsewhere. Never throws for business failures — they end up in the
 * execution (FAILED) and its step trace.
 */
export async function runExecution(executionId: string, opts: { now?: Date; force?: boolean } = {}): Promise<RunResult | null> {
  const now = opts.now ?? new Date();
  const token = await claim(executionId, now, { force: opts.force });
  if (!token) return null;
  const row = (await prisma.crmWorkflowExecution.findUnique({ where: { id: executionId }, include: { workflow: true, workflowVersion: true } })) as ExecutionRow;
  try {
    return await runExecutionRow(row, token, now);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Workflow execution crashed", { executionId, error: message });
    await finish(row.id, token, "FAILED", "FAILED", { errorCode: "ENGINE_ERROR", errorMessage: message });
    await recordFailureEvent(row, message, "ENGINE_ERROR");
    return { executionId, status: "FAILED", steps: 0 };
  }
}

async function runExecutionRow(row: ExecutionRow, token: string, now: Date): Promise<RunResult> {
  const test = row.mode === "TEST";
  let steps = 0;
  // Workflow lifecycle (live executions only; tests run whatever the status).
  if (!test) {
    if (row.workflow.status === "PAUSED") {
      await prisma.crmWorkflowExecution.updateMany({ where: { id: row.id, lockToken: token }, data: { status: "PAUSED", lockedAt: null, lockToken: null } });
      return { executionId: row.id, status: "PAUSED", steps };
    }
    if (row.workflow.status === "DISABLED" || row.workflow.status === "ARCHIVED") {
      await finish(row.id, token, "CANCELLED", "CANCELLED", { exitReason: `Workflow ${row.workflow.status.toLowerCase()}.` });
      return { executionId: row.id, status: "CANCELLED", steps };
    }
  }
  const parsed = workflowDefinitionSchema.safeParse(row.workflowVersion.definition);
  if (!parsed.success) {
    await finish(row.id, token, "FAILED", "FAILED", { errorCode: "INVALID_DEFINITION", errorMessage: "The workflow version can't be read." });
    return { executionId: row.id, status: "FAILED", steps };
  }
  const def = parsed.data;
  const nodes = nodeMap(def);
  const ctx = readContext(row);
  const visits = { ...(ctx.visits ?? {}) };
  const trigger = ctx.trigger ?? null;
  const entityType = row.entityType as CrmEntityType;
  const entityId = row.entityId as string;

  // Execution identity.
  const runAs = row.runAsUserId;
  if (!runAs || !(await PermissionService.can(runAs, "crm", "view"))) {
    const msg = "The workflow's run-as user is missing, suspended or no longer has CRM access. Publish the workflow again as an active user.";
    await finish(row.id, token, "FAILED", "FAILED", { errorCode: "RUN_AS_INVALID", errorMessage: msg });
    await recordFailureEvent(row, msg, "RUN_AS_INVALID");
    return { executionId: row.id, status: "FAILED", steps };
  }
  const actor = { companyId: row.companyId, userId: runAs, branchId: null };
  const labels = await fieldLabels(row.companyId, def);
  let current: string | null = row.currentNodeId ?? def.entryNodeId;
  let stepCount = row.stepCount;
  let retryCount = row.retryCount;
  let waitingNodeId = ctx.waitingNodeId ?? null;
  const startedAt = row.startedAt ?? now;
  if (!row.startedAt) await prisma.crmWorkflowExecution.update({ where: { id: row.id }, data: { startedAt } });

  const persist = async (data: Prisma.CrmWorkflowExecutionUpdateManyMutationInput) => {
    await prisma.crmWorkflowExecution.updateMany({ where: { id: row.id, lockToken: token }, data: { currentNodeId: current, stepCount, retryCount, context: json({ ...ctx, visits, waitingNodeId }), ...data } });
  };
  const snapshot = async () => buildConditionSnapshot(await loadRecordSnapshot(row.companyId, entityType, entityId), trigger, { startedAt: startedAt.toISOString() });

  while (steps < WORKFLOW_LIMITS.maxStepsPerRun) {
    if (current === null) {
      await persist({});
      await finish(row.id, token, "COMPLETED", "COMPLETED", { currentNodeId: null });
      return { executionId: row.id, status: "COMPLETED", steps };
    }
    if (stepCount >= WORKFLOW_LIMITS.maxStepsPerExecution) {
      await persist({});
      await finish(row.id, token, "FAILED", "FAILED", { errorCode: "STEP_LIMIT", errorMessage: `Stopped after ${stepCount} steps.` });
      await recordFailureEvent(row, "Step limit reached.", "STEP_LIMIT");
      return { executionId: row.id, status: "FAILED", steps };
    }
    const node = nodes.get(current);
    if (!node) {
      await finish(row.id, token, "FAILED", "FAILED", { errorCode: "MISSING_NODE", errorMessage: `Step "${current}" doesn't exist in this version.` });
      return { executionId: row.id, status: "FAILED", steps };
    }
    // Exit conditions are checked before every step (not while resuming a wait mid-way).
    if (def.settings.exitConditions?.conditions.length && waitingNodeId !== node.id) {
      const snap = await snapshot();
      if (evaluateGroup(def.settings.exitConditions, snap, now)) {
        await writeStep(row, { nodeId: node.id, nodeType: "EXIT", status: "COMPLETED", idempotencyKey: `${row.id}:exit:${stepCount}`, output: { reason: "Exit conditions matched", explanation: explainGroup(def.settings.exitConditions, snap, labels, now) } });
        stepCount++;
        await persist({});
        await finish(row.id, token, "EXITED", "EXITED", { exitReason: "Exit conditions matched." });
        return { executionId: row.id, status: "EXITED", steps: steps + 1 };
      }
    }
    const visit = (visits[node.id] ?? 0) + (waitingNodeId === node.id || retryCount > 0 ? 0 : 1);
    visits[node.id] = Math.max(visit, 1);
    const stepKey = `${row.id}:${node.id}:${visits[node.id]}`;
    steps++;
    stepCount++;

    switch (node.type) {
      case "CONDITION": {
        const snap = await snapshot();
        const result = evaluateGroup(node.condition, snap, now);
        await writeStep(row, { nodeId: node.id, nodeType: node.type, status: "COMPLETED", idempotencyKey: stepKey, branch: result ? "true" : "false", output: { result, explanation: explainGroup(node.condition, snap, labels, now) } });
        current = result ? node.onTrue : node.onFalse;
        break;
      }
      case "BRANCH": {
        const snap = await snapshot();
        const hit = node.branches.find((b) => evaluateGroup(b.condition, snap, now));
        await writeStep(row, { nodeId: node.id, nodeType: node.type, status: "COMPLETED", idempotencyKey: stepKey, branch: hit?.id ?? "default", output: { branch: hit?.name ?? "Default" } });
        current = hit ? hit.next : node.defaultNext;
        break;
      }
      case "GOAL": {
        const snap = await snapshot();
        const met = evaluateGroup(node.condition, snap, now);
        await writeStep(row, { nodeId: node.id, nodeType: node.type, status: "COMPLETED", idempotencyKey: stepKey, branch: met ? "goal" : "continue", output: { met, explanation: explainGroup(node.condition, snap, labels, now) } });
        if (met) {
          await persist({});
          await finish(row.id, token, "COMPLETED", "GOAL_REACHED", { currentNodeId: node.id, exitReason: node.name ? `Goal: ${node.name}` : "Goal reached." });
          return { executionId: row.id, status: "COMPLETED", steps };
        }
        current = node.next;
        break;
      }
      case "EXIT": {
        await writeStep(row, { nodeId: node.id, nodeType: node.type, status: "COMPLETED", idempotencyKey: stepKey, output: { reason: node.reason ?? null } });
        await persist({});
        await finish(row.id, token, "EXITED", "EXITED", { currentNodeId: node.id, exitReason: node.reason ?? "Exit step." });
        return { executionId: row.id, status: "EXITED", steps };
      }
      case "WAIT": {
        if (waitingNodeId === node.id) {
          // Resuming: the wait is over.
          await prisma.crmWorkflowExecutionStep.updateMany({ where: { executionId: row.id, nodeId: node.id, status: "WAITING" }, data: { status: "COMPLETED", finishedAt: now } });
          waitingNodeId = null;
          current = node.next;
          stepCount--; // the wait was counted when it started
          break;
        }
        const fieldLabel = node.wait.mode === "UNTIL_FIELD" ? labels.get(node.wait.field) : undefined;
        const fieldValue = node.wait.mode === "UNTIL_FIELD" ? (await snapshot())[node.wait.field] : undefined;
        const resumeAt = computeResumeAt(node.wait, now, def.settings.timezone, fieldValue);
        const description = describeWait(node.wait, fieldLabel);
        if (test) {
          await writeStep(row, { nodeId: node.id, nodeType: node.type, status: "SIMULATED", idempotencyKey: stepKey, output: { wait: description, wouldResumeAt: resumeAt.toISOString() } });
          current = node.next;
          break;
        }
        if (resumeAt.getTime() <= now.getTime()) {
          await writeStep(row, { nodeId: node.id, nodeType: node.type, status: "COMPLETED", idempotencyKey: stepKey, output: { wait: description, resumeAt: resumeAt.toISOString(), note: "Already due — continued immediately." } });
          current = node.next;
          break;
        }
        await writeStep(row, { nodeId: node.id, nodeType: node.type, status: "WAITING", idempotencyKey: stepKey, output: { wait: description, resumeAt: resumeAt.toISOString(), timezone: def.settings.timezone }, finished: false });
        waitingNodeId = node.id;
        await persist({ status: "WAITING", nextRunAt: resumeAt, lockedAt: null, lockToken: null });
        return { executionId: row.id, status: "WAITING", steps };
      }
      case "ACTION": {
        const key = node.action as WorkflowActionKey;
        const adef = WORKFLOW_ACTIONS[key] as WorkflowActionDef | undefined;
        if (!adef) {
          await writeStep(row, { nodeId: node.id, nodeType: node.type, actionKey: node.action, status: "FAILED", idempotencyKey: `${stepKey}:a${retryCount + 1}`, errorCode: "UNKNOWN_ACTION", errorMessage: `Unknown action "${node.action}".` });
          await persist({});
          await finish(row.id, token, "FAILED", "FAILED", { errorCode: "UNKNOWN_ACTION", errorMessage: `Unknown action "${node.action}".` });
          return { executionId: row.id, status: "FAILED", steps };
        }
        const attempt = retryCount + 1;
        const step = await writeStep(row, { nodeId: node.id, nodeType: node.type, actionKey: key, status: "RUNNING", attempt, idempotencyKey: `${stepKey}:a${attempt}`, input: node.params, finished: false });
        await persist({});
        const record = await loadRecordSnapshot(row.companyId, entityType, entityId);
        try {
          const result = await runWithRequestContext({ requestId: `${WORKFLOW_CORRELATION_PREFIX}${row.id}`, userId: runAs, companyId: row.companyId }, () =>
            runWorkflowAction(key, {
              companyId: row.companyId,
              actor,
              workflow: { id: row.workflowId, name: row.workflow.name },
              execution: { id: row.id },
              step: { idempotencyKey: stepKey, nodeId: node.id },
              entityType,
              entityId,
              record,
              trigger,
              params: node.params,
              dryRun: test,
            })
          );
          await prisma.crmWorkflowExecutionStep.update({ where: { id: step.id }, data: { status: test ? "SIMULATED" : "COMPLETED", output: json({ summary: result.summary, ...result.output }), finishedAt: new Date() } });
          retryCount = 0;
          current = node.next;
        } catch (e) {
          const err = e instanceof WorkflowActionError ? e : new WorkflowActionError(e instanceof Error ? e.message : String(e), "UNEXPECTED", false);
          await prisma.crmWorkflowExecutionStep.update({ where: { id: step.id }, data: { status: "FAILED", errorCode: err.code, errorMessage: err.message.slice(0, 2000), finishedAt: new Date() } });
          if (!test && err.retryable && retryCount < WORKFLOW_LIMITS.maxRetries) {
            const delay = WORKFLOW_LIMITS.retryDelaysMs[Math.min(retryCount, WORKFLOW_LIMITS.retryDelaysMs.length - 1)];
            retryCount++;
            stepCount--; // the retry re-runs the same step
            await persist({ status: "WAITING", nextRunAt: new Date(now.getTime() + delay), lockedAt: null, lockToken: null, errorCode: err.code, errorMessage: `Retry ${retryCount}/${WORKFLOW_LIMITS.maxRetries}: ${err.message}`.slice(0, 2000) });
            return { executionId: row.id, status: "WAITING", steps };
          }
          retryCount = 0;
          if (node.onError === "CONTINUE") {
            current = node.next;
            break;
          }
          await persist({});
          await finish(row.id, token, "FAILED", "FAILED", { errorCode: err.code, errorMessage: `${adef.label}: ${err.message}` });
          await recordFailureEvent(row, `${adef.label}: ${err.message}`, err.code);
          return { executionId: row.id, status: "FAILED", steps };
        }
        break;
      }
    }
    await persist({ errorCode: null, errorMessage: null });
  }
  // Yield: give other executions a turn; the scheduler picks it up again.
  await persist({ status: "QUEUED", nextRunAt: now, lockedAt: null, lockToken: null });
  return { executionId: row.id, status: "QUEUED", steps };
}

// ── Scheduler passes ────────────────────────────────────────────

/** Due executions (queued, or waiting whose time has come), oldest first. */
export async function runDueExecutions(now: Date = new Date(), batch = 50): Promise<number> {
  const due = await prisma.crmWorkflowExecution.findMany({
    where: { status: { in: ["QUEUED", "WAITING"] }, mode: "LIVE", OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] },
    orderBy: [{ nextRunAt: "asc" }, { createdAt: "asc" }],
    take: batch,
    select: { id: true },
  });
  let ran = 0;
  for (const { id } of due) if (await runExecution(id, { now })) ran++;
  return ran;
}

/**
 * Executions left RUNNING by a crashed worker. If the interrupted step is an
 * action that is safe to repeat (tasks are idempotent by reference, status
 * changes are no-ops when already applied) it runs again; a message or
 * webhook whose outcome is unknown is never re-sent automatically — the
 * execution fails and a person decides (Retry re-uses the same message id,
 * so the Inbox de-duplicates it).
 */
export async function recoverStaleExecutions(now: Date = new Date()): Promise<number> {
  const stale = await prisma.crmWorkflowExecution.findMany({ where: { status: "RUNNING", lockedAt: { lt: new Date(now.getTime() - WORKFLOW_LIMITS.staleLockMs) } }, select: { id: true, lockToken: true, companyId: true, workflowId: true, entityType: true, entityId: true, mode: true } });
  for (const ex of stale) {
    const running = await prisma.crmWorkflowExecutionStep.findFirst({ where: { executionId: ex.id, status: "RUNNING" }, orderBy: { sequence: "desc" } });
    const def = running?.actionKey ? (WORKFLOW_ACTIONS[running.actionKey as WorkflowActionKey] as WorkflowActionDef | undefined) : undefined;
    if (running) await prisma.crmWorkflowExecutionStep.update({ where: { id: running.id }, data: { status: "FAILED", errorCode: "INTERRUPTED", errorMessage: "The worker stopped while this step was running.", finishedAt: now } });
    if (running && def && !def.retryable) {
      const msg = `Interrupted while running "${def.label}"; it may or may not have happened, so it was not repeated automatically. Check, then Retry if needed.`;
      await prisma.crmWorkflowExecution.updateMany({ where: { id: ex.id, lockToken: ex.lockToken }, data: { status: "FAILED", outcome: "FAILED", errorCode: "INTERRUPTED", errorMessage: msg, finishedAt: now, lockedAt: null, lockToken: null } });
      await recordFailureEvent(ex, msg, "INTERRUPTED");
    } else {
      await prisma.crmWorkflowExecution.updateMany({ where: { id: ex.id, lockToken: ex.lockToken }, data: { status: "QUEUED", nextRunAt: now, lockedAt: null, lockToken: null } });
    }
  }
  return stale.length;
}

/** One scheduler pass. Run by the worker every 15 s (and kicked after commits). */
export async function tickWorkflows(now: Date = new Date()) {
  const recovered = await recoverStaleExecutions(now);
  const dispatched = await dispatchWorkflowEvents(now);
  const ran = await runDueExecutions(now);
  // Housekeeping: the event log only needs to cover the look-back window.
  if (now.getUTCMinutes() === 0 && now.getUTCSeconds() < 20) await prisma.crmWorkflowEventLog.deleteMany({ where: { processedAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } } });
  return { recovered, ...dispatched, ran };
}

export { WORKFLOW_TRIGGER_KEYS };
