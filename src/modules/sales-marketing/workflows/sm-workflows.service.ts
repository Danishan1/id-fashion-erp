import { Prisma } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { conditionGroupSchema, emptyGroup, validateConditionGroup, type ConditionGroup } from "@/modules/crm/workflows/workflow-conditions";
import { retryBulkJob } from "@/modules/bulk-actions/bulk-jobs.service";
import { scheduleAttributionRun } from "@/modules/sales-marketing/attribution/attribution-jobs.worker";
import { executeRun, requestRun } from "@/modules/sales-marketing/attribution/attribution-run.service";
import { canSeeCampaign } from "@/modules/sales-marketing/campaigns/campaign-common";
import { assertSalesEnquiryVisible, type SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { assertQuotationVisible } from "@/modules/sales-marketing/quotations/quotation.service";
import { publishWorkflowEvent } from "@/modules/sales-marketing/integrations/public-events";
import { compensateInstance, operatorTransition, runAsProblem, runInstance, startInstance } from "./sm-workflow-engine";
import "./sm-workflow-impls";
import {
  SM_WF_LIMITS,
  SM_WF_OPERATOR_ACTIONS,
  SM_WF_OUTCOMES,
  SM_WF_SETTINGS_SCHEMAS,
  SM_WF_STATUS_KEYS,
  SM_WF_STATUSES,
  SM_WORKFLOW_KEYS,
  SM_WORKFLOWS,
  type SmWfOperatorAction,
  type SmWfStatus,
  type SmWorkflowKey,
} from "./sm-workflow-registry";

/**
 * Phase 15 — S&M workflows: definitions (per company, one per registered
 * type), their versions, running instances, operator actions and metrics.
 *
 * Permissions (module sales_workflows): view = monitor; edit = configure,
 * activate / deactivate, start on a record; approve = retry, resolve, cancel.
 * Business approvals (quotations, campaigns…) stay in their own modules.
 * Activating makes the activator the run-as user: they must hold every
 * permission the workflow's actions need, and that is checked again before
 * every action.
 */

const TABLE_DEF = "sm_workflow_definitions";
const TABLE_INST = "sm_workflow_instances";
const assertKey = (k: string): SmWorkflowKey => {
  if (!(SM_WORKFLOW_KEYS as string[]).includes(k)) throw new BusinessRuleError("NOT_FOUND", "Unknown workflow.", { key: k });
  return k as SmWorkflowKey;
};
const conditionsOf = (raw: unknown): { entry: ConditionGroup } => {
  const entry = (raw as { entry?: unknown } | null)?.entry;
  return { entry: entry ? conditionGroupSchema.parse(entry) : emptyGroup() };
};

// ── Definitions ──────────────────────────────────────────────────

/** One definition per workflow type, created off with default settings on first use. */
async function ensureDefinitions(actor: SalesActor) {
  const existing = await prisma.smWorkflowDefinition.findMany({ where: { companyId: actor.companyId }, select: { workflowKey: true } });
  const have = new Set(existing.map((d) => d.workflowKey));
  for (const key of SM_WORKFLOW_KEYS) {
    if (have.has(key)) continue;
    try {
      await prisma.$transaction(async (tx) => {
        const def = await tx.smWorkflowDefinition.create({ data: { companyId: actor.companyId, workflowKey: key, name: SM_WORKFLOWS[key].name } });
        await tx.smWorkflowDefinitionVersion.create({ data: { companyId: actor.companyId, definitionId: def.id, versionNumber: 1, status: "DRAFT", settings: SM_WF_SETTINGS_SCHEMAS[key].parse({}) as Prisma.InputJsonValue, conditions: { entry: emptyGroup() } as unknown as Prisma.InputJsonValue, changeNote: "Default settings", createdByUserId: actor.userId } });
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; // created concurrently
    }
  }
}

async function loadDefinition(actor: SalesActor, key: SmWorkflowKey) {
  await ensureDefinitions(actor);
  return prisma.smWorkflowDefinition.findFirstOrThrow({ where: { companyId: actor.companyId, workflowKey: key }, include: { activeVersion: true, versions: { orderBy: { versionNumber: "desc" } } } });
}

async function userNames(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const rows = list.length ? await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, fullName: true } }) : [];
  return new Map(rows.map((r) => [r.id, r.fullName]));
}

function presentVersion(v: Prisma.SmWorkflowDefinitionVersionGetPayload<object>, names: Map<string, string>) {
  return {
    id: v.id,
    versionNumber: v.versionNumber,
    status: v.status,
    settings: v.settings as Record<string, unknown>,
    conditions: conditionsOf(v.conditions),
    changeNote: v.changeNote,
    createdBy: names.get(v.createdByUserId) ?? null,
    createdAt: v.createdAt,
    activatedAt: v.activatedAt,
    activatedBy: v.activatedById ? (names.get(v.activatedById) ?? null) : null,
  };
}

export async function listDefinitions(actor: SalesActor) {
  await PermissionService.assert(actor.userId, "sales_workflows", "view");
  await ensureDefinitions(actor);
  const defs = await prisma.smWorkflowDefinition.findMany({ where: { companyId: actor.companyId }, include: { activeVersion: true, versions: { where: { status: "DRAFT" } } } });
  const counts = await prisma.smWorkflowInstance.groupBy({ by: ["definitionId", "status"], where: { companyId: actor.companyId }, _count: { _all: true } });
  const names = await userNames(defs.map((d) => d.runAsUserId));
  return SM_WORKFLOW_KEYS.map((key) => {
    const d = defs.find((x) => x.workflowKey === key)!;
    const c = (s: SmWfStatus[]) => counts.filter((g) => g.definitionId === d.id && s.includes(g.status as SmWfStatus)).reduce((a, g) => a + g._count._all, 0);
    return {
      key,
      name: SM_WORKFLOWS[key].name,
      description: SM_WORKFLOWS[key].description,
      status: d.status,
      activeVersion: d.activeVersion?.versionNumber ?? null,
      hasDraft: d.versions.length > 0,
      runAs: d.runAsUserId ? (names.get(d.runAsUserId) ?? null) : null,
      activatedAt: d.activatedAt,
      live: c(["RUNNING", "WAITING_APPROVAL", "WAITING_EVENT", "SCHEDULED", "RETRY_PENDING"]),
      attention: c(["NEEDS_ATTENTION", "FAILED"]),
      completed: c(["COMPLETED"]),
    };
  });
}

export async function getDefinition(actor: SalesActor, keyRaw: string) {
  await PermissionService.assert(actor.userId, "sales_workflows", "view");
  const key = assertKey(keyRaw);
  const d = await loadDefinition(actor, key);
  const names = await userNames([d.runAsUserId, ...d.versions.flatMap((v) => [v.createdByUserId, v.activatedById])]);
  const wf = SM_WORKFLOWS[key];
  const runAsIssue = d.status === "ACTIVE" && d.activeVersion ? await runAsProblem(key, actor.companyId, d.runAsUserId, d.activeVersion.settings as Record<string, unknown>) : null;
  return {
    key,
    definitionId: d.id,
    name: wf.name,
    description: wf.description,
    entityLabel: wf.entityLabel,
    triggers: wf.triggers,
    steps: wf.steps,
    boundaries: wf.boundaries,
    settingFields: wf.settingFields,
    conditionFields: wf.conditionFields,
    requiredPermissions: wf.requiredPermissions,
    taskPermissions: wf.taskPermissions ?? [],
    status: d.status,
    version: d.version,
    runAs: d.runAsUserId ? { id: d.runAsUserId, name: names.get(d.runAsUserId) ?? null } : null,
    runAsIssue,
    activatedAt: d.activatedAt,
    activeVersion: d.activeVersion ? presentVersion(d.activeVersion, names) : null,
    draft: d.versions.find((v) => v.status === "DRAFT") ? presentVersion(d.versions.find((v) => v.status === "DRAFT")!, names) : null,
    versions: d.versions.map((v) => presentVersion(v, names)),
    canEdit: await PermissionService.can(actor.userId, "sales_workflows", "edit"),
  };
}

const draftSchema = z.object({ version: z.coerce.number().int(), settings: z.record(z.string(), z.unknown()), conditions: z.object({ entry: z.unknown() }).strict(), changeNote: z.string().trim().max(500).optional().or(z.literal("")) }).strict();

/** Settings + conditions checked against the workflow type (typed settings, allow-listed fields and operators). */
export function validateConfig(key: SmWorkflowKey, raw: { settings: unknown; conditions: unknown }) {
  const errors: { path: string; message: string }[] = [];
  const parsed = SM_WF_SETTINGS_SCHEMAS[key].safeParse(raw.settings ?? {});
  if (!parsed.success) for (const i of parsed.error.issues) errors.push({ path: `settings.${i.path.join(".")}`, message: i.message });
  let entry: ConditionGroup = emptyGroup();
  const g = conditionGroupSchema.safeParse((raw.conditions as { entry?: unknown } | null)?.entry ?? emptyGroup());
  if (!g.success) errors.push({ path: "conditions.entry", message: "The conditions are not valid." });
  else {
    entry = g.data;
    const fields = new Map(SM_WORKFLOWS[key].conditionFields.map((f) => [f.key, f]));
    for (const issue of validateConditionGroup(entry, fields, "conditions.entry")) errors.push(issue);
  }
  return { valid: errors.length === 0, errors, settings: parsed.success ? (parsed.data as Record<string, unknown>) : null, conditions: { entry } };
}

/** Validates users named in settings: active users of this company. */
async function checkSettingUsers(actor: SalesActor, settings: Record<string, unknown>) {
  const ids = Object.values(settings).filter(Array.isArray).flat() as string[];
  if (!ids.length) return;
  const found = await prisma.user.count({ where: { id: { in: [...new Set(ids)] }, companyId: actor.companyId, status: "ACTIVE" } });
  if (found !== new Set(ids).size) throw new BusinessRuleError("VALIDATION_ERROR", "Choose active users of this company.", { fieldErrors: { settings: "Unknown or inactive user." } });
}

export async function validateDraft(actor: SalesActor, keyRaw: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_workflows", "edit");
  const key = assertKey(keyRaw);
  const input = z.object({ settings: z.record(z.string(), z.unknown()), conditions: z.object({ entry: z.unknown() }) }).parse(raw);
  const r = validateConfig(key, input);
  return { valid: r.valid, errors: r.errors };
}

/** Saves the draft version (creating v N+1 when the last one is active). An active version never changes. */
export async function saveDraft(actor: SalesActor, keyRaw: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_workflows", "edit");
  const key = assertKey(keyRaw);
  const input = draftSchema.parse(raw);
  const r = validateConfig(key, input);
  if (!r.valid) throw new BusinessRuleError("VALIDATION_ERROR", "Fix the workflow's settings first.", { fieldErrors: Object.fromEntries(r.errors.map((e) => [e.path, e.message])) });
  await checkSettingUsers(actor, r.settings!);
  const d = await loadDefinition(actor, key);
  const draft = d.versions.find((v) => v.status === "DRAFT");
  await prisma.$transaction(async (tx) => {
    const bumped = await tx.smWorkflowDefinition.updateMany({ where: { id: d.id, version: input.version }, data: { version: { increment: 1 } } });
    if (!bumped.count) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "The workflow changed just now. Reload and try again.");
    const data = { settings: r.settings as Prisma.InputJsonValue, conditions: r.conditions as unknown as Prisma.InputJsonValue, changeNote: input.changeNote || null };
    if (draft) await tx.smWorkflowDefinitionVersion.update({ where: { id: draft.id }, data });
    else await tx.smWorkflowDefinitionVersion.create({ data: { ...data, companyId: actor.companyId, definitionId: d.id, versionNumber: (d.versions[0]?.versionNumber ?? 0) + 1, status: "DRAFT", createdByUserId: actor.userId } });
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE_DEF, recordId: d.id, action: "UPDATE", newValues: { draftSaved: key, ...data } }, tx);
  });
  return getDefinition(actor, key);
}

/**
 * Activates the draft (or re-activates the current version). The activator
 * becomes the run-as user and must hold every permission the actions need.
 * Running instances keep the version they started with.
 */
export async function activateDefinition(actor: SalesActor, keyRaw: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_workflows", "edit");
  const key = assertKey(keyRaw);
  const { version } = z.object({ version: z.coerce.number().int() }).parse(raw);
  const d = await loadDefinition(actor, key);
  const draft = d.versions.find((v) => v.status === "DRAFT");
  const target = draft ?? d.activeVersion;
  if (!target) throw new BusinessRuleError("VALIDATION_ERROR", "There is nothing to activate.");
  const r = validateConfig(key, { settings: target.settings, conditions: target.conditions });
  if (!r.valid) throw new BusinessRuleError("VALIDATION_ERROR", "Fix the workflow's settings first.", { fieldErrors: Object.fromEntries(r.errors.map((e) => [e.path, e.message])) });
  const problem = await runAsProblem(key, actor.companyId, actor.userId, r.settings!);
  if (problem) throw new BusinessRuleError("PERMISSION_DENIED", problem.replace("The user the workflow runs as no longer has", "You need").replace("The user the workflow runs as", "You"));
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const bumped = await tx.smWorkflowDefinition.updateMany({ where: { id: d.id, version }, data: { version: { increment: 1 } } });
    if (!bumped.count) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "The workflow changed just now. Reload and try again.");
    if (draft) {
      if (d.activeVersion) await tx.smWorkflowDefinitionVersion.update({ where: { id: d.activeVersion.id }, data: { status: "SUPERSEDED" } });
      await tx.smWorkflowDefinitionVersion.update({ where: { id: draft.id }, data: { status: "ACTIVE", activatedAt: now, activatedById: actor.userId } });
    }
    await tx.smWorkflowDefinition.update({ where: { id: d.id }, data: { status: "ACTIVE", activeVersionId: target.id, runAsUserId: actor.userId, activatedAt: now } });
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE_DEF, recordId: d.id, action: "UPDATE", oldValues: { status: d.status, activeVersion: d.activeVersion?.versionNumber ?? null }, newValues: { status: "ACTIVE", activeVersion: target.versionNumber, runAsUserId: actor.userId } }, tx);
  });
  return getDefinition(actor, key);
}

/** Stops new starts. Running instances finish on the version they started with (cancel them individually if needed). */
export async function deactivateDefinition(actor: SalesActor, keyRaw: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_workflows", "edit");
  const key = assertKey(keyRaw);
  const { version } = z.object({ version: z.coerce.number().int() }).parse(raw);
  const d = await loadDefinition(actor, key);
  if (d.status !== "ACTIVE") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This workflow is already off.");
  const r = await prisma.smWorkflowDefinition.updateMany({ where: { id: d.id, version }, data: { status: "INACTIVE", version: { increment: 1 } } });
  if (!r.count) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "The workflow changed just now. Reload and try again.");
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE_DEF, recordId: d.id, action: "UPDATE", oldValues: { status: "ACTIVE" }, newValues: { status: "INACTIVE" } });
  return getDefinition(actor, key);
}

// ── Instances ────────────────────────────────────────────────────

/** Can the user see the business record (its own module's rule)? Used for manual starts. */
async function assertEntityVisible(actor: SalesActor, entityType: string, entityId: string) {
  if (entityType === "ENQUIRY") return assertSalesEnquiryVisible(actor, entityId);
  if (entityType === "QUOTATION") return assertQuotationVisible(actor, entityId);
  if (entityType === "CAMPAIGN") {
    if (!(await canSeeCampaign(actor, entityId))) throw new BusinessRuleError("NOT_FOUND", "Campaign not found.");
    return;
  }
  if (entityType === "BUDGET_ALERT") {
    const a = await prisma.marketingBudgetAlert.findFirst({ where: { id: entityId, companyId: actor.companyId }, select: { campaignId: true } });
    if (!a || !(await canSeeCampaign(actor, a.campaignId))) throw new BusinessRuleError("NOT_FOUND", "Budget alert not found.");
    return;
  }
  if (entityType === "ATTRIBUTION_RUN") {
    await PermissionService.assert(actor.userId, "marketing_attribution", "view");
    if (!(await prisma.marketingAttributionRun.count({ where: { id: entityId, companyId: actor.companyId } }))) throw new BusinessRuleError("NOT_FOUND", "Run not found.");
    return;
  }
  if (entityType === "BULK_JOB") {
    if (!(await prisma.bulkJob.count({ where: { id: entityId, companyId: actor.companyId } }))) throw new BusinessRuleError("NOT_FOUND", "Job not found.");
    return;
  }
  throw new BusinessRuleError("VALIDATION_ERROR", "This record type can't start a workflow.");
}

const startSchema = z.object({ entityId: z.string().uuid(), entityType: z.string().max(40).optional() }).strict();

/** Explicit start on one record (sales_workflows.edit + the record visible to the user). Entry conditions don't apply to a deliberate start. */
export async function startWorkflowManually(actor: SalesActor, keyRaw: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_workflows", "edit");
  const key = assertKey(keyRaw);
  const input = startSchema.parse(raw);
  const entityType = key === "processing_follow_up" ? (input.entityType === "BULK_JOB" ? "BULK_JOB" : "ATTRIBUTION_RUN") : SM_WORKFLOWS[key].entityType;
  await assertEntityVisible(actor, entityType, input.entityId);
  const d = await loadDefinition(actor, key);
  if (d.status !== "ACTIVE" || !d.activeVersion) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Switch the workflow on first.");
  const { instance, created } = await startInstance(d, { entityType, entityId: input.entityId }, { source: "MANUAL", eventKey: null, userId: actor.userId, event: null });
  if (created) await runInstance(instance.id).catch(() => null);
  return { ...(await getInstance(actor, instance.id)), created };
}

const listSchema = z.object({
  statuses: z.array(z.enum(SM_WF_STATUS_KEYS as [SmWfStatus, ...SmWfStatus[]])).max(9).optional(),
  workflowKey: z.string().max(40).optional(),
  entityId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
});

export async function listInstances(actor: SalesActor, raw: unknown, page: { skip: number; take: number }) {
  await PermissionService.assert(actor.userId, "sales_workflows", "view");
  const f = listSchema.parse(raw ?? {});
  const where: Prisma.SmWorkflowInstanceWhereInput = {
    companyId: actor.companyId,
    ...(f.statuses?.length ? { status: { in: f.statuses } } : {}),
    ...(f.workflowKey ? { workflowKey: f.workflowKey } : {}),
    ...(f.entityId ? { entityId: f.entityId } : {}),
    ...(f.search ? { entityLabel: { contains: f.search, mode: "insensitive" } } : {}),
  };
  const [rows, totalCount] = await Promise.all([prisma.smWorkflowInstance.findMany({ where, orderBy: { updatedAt: "desc" }, skip: page.skip, take: page.take, include: { version: { select: { versionNumber: true } } } }), prisma.smWorkflowInstance.count({ where })]);
  return {
    totalCount,
    data: rows.map((i) => ({
      id: i.id,
      workflowKey: i.workflowKey,
      workflowName: SM_WORKFLOWS[i.workflowKey as SmWorkflowKey]?.name ?? i.workflowKey,
      version: i.version.versionNumber,
      entityType: i.entityType,
      entityId: i.entityId,
      entityLabel: i.entityLabel,
      entityHref: entityHref(i.entityType, i.entityId),
      status: i.status,
      statusLabel: SM_WF_STATUSES[i.status as SmWfStatus]?.label ?? i.status,
      statusTone: SM_WF_STATUSES[i.status as SmWfStatus]?.tone ?? "zinc",
      currentStep: i.currentStep,
      currentStepLabel: SM_WORKFLOWS[i.workflowKey as SmWorkflowKey]?.steps.find((s) => s.key === i.currentStep)?.label ?? i.currentStep,
      outcome: i.outcome,
      outcomeLabel: i.outcome ? (SM_WF_OUTCOMES[i.outcome] ?? i.outcome) : null,
      errorMessage: i.errorMessage,
      nextRunAt: i.nextRunAt,
      startedAt: i.startedAt,
      updatedAt: i.updatedAt,
      triggerSource: i.triggerSource,
    })),
  };
}

export function entityHref(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case "ENQUIRY":
      return `/sales-marketing/enquiries/${entityId}`;
    case "QUOTATION":
      return `/sales-marketing/quotations/${entityId}`;
    case "CAMPAIGN":
      return `/sales-marketing/campaigns/${entityId}`;
    case "BULK_JOB":
      return `/sales-marketing/bulk-jobs/${entityId}`;
    case "ATTRIBUTION_RUN":
      return "/sales-marketing/attribution/models";
    default:
      return null;
  }
}

async function loadInstance(actor: SalesActor, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BusinessRuleError("NOT_FOUND", "Workflow not found.");
  const i = await prisma.smWorkflowInstance.findFirst({ where: { id, companyId: actor.companyId } });
  if (!i) throw new BusinessRuleError("NOT_FOUND", "Workflow not found.", { id });
  return i;
}

export async function getInstance(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "sales_workflows", "view");
  const i = await loadInstance(actor, id);
  const [steps, version, canOperate] = await Promise.all([
    prisma.smWorkflowStepRun.findMany({ where: { instanceId: i.id }, orderBy: { sequence: "asc" } }),
    prisma.smWorkflowDefinitionVersion.findUniqueOrThrow({ where: { id: i.versionId }, select: { versionNumber: true } }),
    PermissionService.can(actor.userId, "sales_workflows", "approve"),
  ]);
  const wf = SM_WORKFLOWS[i.workflowKey as SmWorkflowKey];
  const names = await userNames([i.initiatedByUserId, ...steps.map((s) => s.actorUserId)]);
  const ctx = (i.context ?? {}) as Record<string, unknown>;
  const tasks = Object.entries((ctx.tasks ?? {}) as Record<string, { id: string }>);
  const taskRows = tasks.length ? await prisma.crmActivity.findMany({ where: { id: { in: tasks.map(([, t]) => t.id) }, companyId: actor.companyId }, select: { id: true, subject: true, status: true, dueAt: true, assignedTo: { select: { fullName: true } } } }) : [];
  return {
    id: i.id,
    workflowKey: i.workflowKey,
    workflowName: wf?.name ?? i.workflowKey,
    version: version.versionNumber,
    entityType: i.entityType,
    entityId: i.entityId,
    entityLabel: i.entityLabel,
    entityHref: entityHref(i.entityType, i.entityId),
    status: i.status,
    statusLabel: SM_WF_STATUSES[i.status as SmWfStatus]?.label ?? i.status,
    statusTone: SM_WF_STATUSES[i.status as SmWfStatus]?.tone ?? "zinc",
    currentStep: i.currentStep,
    plan: (wf?.steps ?? []).map((s) => ({ ...s, state: steps.some((r) => r.stepKey === s.key && r.status === "DONE") ? "done" : s.key === i.currentStep && !["COMPLETED", "CANCELLED"].includes(i.status) ? "current" : "pending" })),
    nextRunAt: i.nextRunAt,
    waitingSince: i.waitingSince,
    attempts: i.attempts,
    outcome: i.outcome,
    outcomeLabel: i.outcome ? (SM_WF_OUTCOMES[i.outcome] ?? i.outcome) : null,
    outcomeMessage: i.outcomeMessage,
    error: i.errorCode ? { code: i.errorCode, message: i.errorMessage } : null,
    compensationStatus: i.compensationStatus,
    triggerSource: i.triggerSource,
    triggerEventKey: i.triggerEventKey,
    trigger: (ctx.trigger ?? null) as { type: string; at: string } | null,
    initiatedBy: i.initiatedByUserId ? (names.get(i.initiatedByUserId) ?? null) : null,
    correlationId: i.correlationId,
    checklist: (ctx.checklist ?? null) as { key: string; label: string; ok: boolean; detail: string }[] | null,
    references: {
      quotationId: (ctx.quotationId as string) ?? null,
      quotationNumber: (ctx.quotationNumber as string) ?? null,
      orderId: (ctx.orderId as string) ?? null,
      orderNumber: (ctx.orderNumber as string) ?? null,
      exception: (ctx.exception as string) ?? null,
      kind: (ctx.kind as string) ?? null,
    },
    tasks: taskRows.map((t) => ({ id: t.id, subject: t.subject, status: t.status, dueAt: t.dueAt, assignee: t.assignedTo?.fullName ?? null })),
    steps: steps.map((s) => ({
      id: s.id,
      sequence: s.sequence,
      stepKey: s.stepKey,
      label: wf?.steps.find((x) => x.key === s.stepKey)?.label ?? s.stepKey,
      kind: s.kind,
      status: s.status,
      attempt: s.attempt,
      checks: s.checks,
      summary: s.summary,
      errorCode: s.errorCode,
      errorMessage: s.errorMessage,
      actor: s.actorUserId ? (names.get(s.actorUserId) ?? null) : null,
      startedAt: s.startedAt,
      lastCheckAt: s.lastCheckAt,
      finishedAt: s.finishedAt,
    })),
    actions: canOperate
      ? (Object.keys(SM_WF_OPERATOR_ACTIONS) as SmWfOperatorAction[])
          .filter((a) => (SM_WF_OPERATOR_ACTIONS[a].from as readonly string[]).includes(i.status))
          .map((a): { key: string; label: string; help: string } => ({ key: a, label: SM_WF_OPERATOR_ACTIONS[a].label, help: SM_WF_OPERATOR_ACTIONS[a].help }))
          .concat(i.workflowKey === "processing_follow_up" && !["COMPLETED", "CANCELLED"].includes(i.status) && (ctx.kind === "ATTRIBUTION" || ctx.kind === "BULK") ? [{ key: "retry_processing", label: ctx.kind === "ATTRIBUTION" ? "Recalculate (Phase 13)" : "Retry failed records (Phase 14)", help: "Starts the module's own re-run; the workflow finishes when it succeeds." }] : [])
      : [],
    startedAt: i.startedAt,
    completedAt: i.completedAt,
    updatedAt: i.updatedAt,
  };
}

const actionSchema = z.object({ action: z.enum(["retry", "resolve", "cancel", "retry_processing"]), note: z.string().trim().max(1000).optional().or(z.literal("")) }).strict();

async function operatorStep(i: { id: string; companyId: string; currentStep: string }, actor: SalesActor, summary: string, status: "DONE" | "COMPENSATED" | "COMPENSATION_FAILED" = "DONE", kind = "OPERATOR") {
  const last = await prisma.smWorkflowStepRun.findFirst({ where: { instanceId: i.id }, orderBy: { sequence: "desc" } });
  await prisma.smWorkflowStepRun.create({ data: { companyId: i.companyId, instanceId: i.id, sequence: (last?.sequence ?? 0) + 1, stepKey: i.currentStep, kind, status, summary: summary.slice(0, 500), actorUserId: actor.userId, finishedAt: new Date() } });
}

/** Retry / resolve / cancel (sales_workflows.approve), and the processing re-run for exceptions. Each is audited and leaves a step row. */
export async function instanceAction(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_workflows", "approve");
  const input = actionSchema.parse(raw ?? {});
  const i = await loadInstance(actor, id);
  const note = input.note || null;
  const now = new Date();
  if (input.action === "retry") {
    if (!(SM_WF_OPERATOR_ACTIONS.retry.from as readonly string[]).includes(i.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a failed, waiting-for-retry or needs-attention workflow can be retried.");
    await operatorTransition(i, "RUNNING", { attempts: 0, nextRunAt: now, errorCode: null, errorMessage: null });
    await operatorStep(i, actor, `Retried by a person${note ? `: ${note}` : ""}.`);
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE_INST, recordId: i.id, action: "UPDATE", oldValues: { status: i.status, errorCode: i.errorCode }, newValues: { action: "retry", note } });
    await runInstance(i.id).catch(() => null);
  } else if (input.action === "resolve") {
    if (!note || note.length < 3) throw new BusinessRuleError("VALIDATION_ERROR", "Say how it was resolved.", { fieldErrors: { note: "Required." } });
    if (!(SM_WF_OPERATOR_ACTIONS.resolve.from as readonly string[]).includes(i.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This workflow can't be resolved now.");
    await operatorTransition(i, "COMPLETED", { outcome: "RESOLVED_MANUALLY", outcomeMessage: note, completedAt: now, nextRunAt: null });
    await operatorStep(i, actor, `Resolved by a person: ${note}`);
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE_INST, recordId: i.id, action: "UPDATE", oldValues: { status: i.status }, newValues: { action: "resolve", note } });
    await publishWorkflowEvent(i, "completed", { outcome: "RESOLVED_MANUALLY" }, now);
  } else if (input.action === "cancel") {
    if (!(SM_WF_OPERATOR_ACTIONS.cancel.from as readonly string[]).includes(i.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This workflow has already ended.");
    // Claim it first (never while a worker runs it), then undo what is safely undoable.
    await operatorTransition(i, "CANCELLED", { completedAt: now, nextRunAt: null, outcome: "CANCELLED", outcomeMessage: note });
    const comp = await compensateInstance(i);
    await prisma.smWorkflowInstance.update({ where: { id: i.id }, data: { compensationStatus: comp.status } });
    await operatorStep(i, actor, `Cancelled${note ? `: ${note}` : ""}. ${comp.summary}`, comp.status === "FAILED" ? "COMPENSATION_FAILED" : comp.status === "DONE" ? "COMPENSATED" : "DONE", comp.status === "NONE" ? "OPERATOR" : "COMPENSATE");
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE_INST, recordId: i.id, action: "CANCEL", oldValues: { status: i.status }, newValues: { note, compensation: comp } });
  } else {
    if (i.workflowKey !== "processing_follow_up" || ["COMPLETED", "CANCELLED"].includes(i.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only an open processing exception can be re-run.");
    const ctx = (i.context ?? {}) as Record<string, unknown>;
    let summary: string;
    if (ctx.kind === "ATTRIBUTION") {
      const run = await prisma.marketingAttributionRun.findFirstOrThrow({ where: { id: i.entityId, companyId: actor.companyId }, select: { modelId: true, periodFrom: true, periodTo: true } });
      // Through the Phase 13 run service, as the person (needs marketing_attribution.edit); idempotent per workflow + attempt.
      const attempt = Number(ctx.reruns ?? 0) + 1;
      const r = await requestRun(actor, run.modelId, { from: run.periodFrom.toISOString().slice(0, 10), to: run.periodTo.toISOString().slice(0, 10), idempotencyKey: `smwf:${i.id}:${attempt}` });
      if (r.created && !(await scheduleAttributionRun(r.run.id))) void executeRun(r.run.id).catch(() => undefined);
      await prisma.smWorkflowInstance.update({ where: { id: i.id }, data: { context: { ...ctx, reruns: attempt } as Prisma.InputJsonValue } });
      summary = `Recalculation requested (run ${r.run.id.slice(0, 8)}).`;
    } else {
      // Through the Phase 14 engine (the person must be allowed to retry the job).
      const job = await retryBulkJob({ companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null }, i.entityId, {});
      summary = `Retry of the failed records started (job ${job.id.slice(0, 8)}).`;
    }
    await operatorStep(i, actor, `${summary}${note ? ` ${note}` : ""}`);
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE_INST, recordId: i.id, action: "UPDATE", newValues: { action: "retry_processing", summary } });
  }
  return getInstance(actor, i.id);
}

// ── Metrics ──────────────────────────────────────────────────────

export async function workflowMetrics(actor: SalesActor) {
  await PermissionService.assert(actor.userId, "sales_workflows", "view");
  const now = Date.now();
  const since = new Date(now - 30 * 86_400_000);
  const [byStatus, finished, approvalWaits, retries, compensationFailed, overdue, checkpoints] = await Promise.all([
    prisma.smWorkflowInstance.groupBy({ by: ["workflowKey", "status"], where: { companyId: actor.companyId }, _count: { _all: true } }),
    prisma.smWorkflowInstance.groupBy({ by: ["status"], where: { companyId: actor.companyId, updatedAt: { gte: since }, status: { in: ["COMPLETED", "FAILED", "CANCELLED"] } }, _count: { _all: true } }),
    prisma.$queryRaw<{ avg_hours: number | null; n: bigint }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM (s.finished_at - s.started_at)) / 3600)::float AS avg_hours, COUNT(*) AS n
      FROM sm_workflow_step_runs s
      WHERE s.company_id = ${actor.companyId}::uuid AND s.step_key = 'await_approval' AND s.status = 'DONE' AND s.finished_at >= ${since}`,
    prisma.smWorkflowStepRun.count({ where: { companyId: actor.companyId, attempt: { gt: 1 }, startedAt: { gte: since } } }),
    prisma.smWorkflowInstance.count({ where: { companyId: actor.companyId, compensationStatus: "FAILED" } }),
    prisma.smWorkflowInstance.findMany({ where: { companyId: actor.companyId, status: { in: ["RUNNING", "WAITING_APPROVAL", "WAITING_EVENT", "SCHEDULED", "RETRY_PENDING"] }, nextRunAt: { lt: new Date(now - 60_000) } }, select: { nextRunAt: true } }),
    prisma.smWorkflowCheckpoint.findMany(),
  ]);
  const count = (statuses: string[]) => byStatus.filter((g) => statuses.includes(g.status)).reduce((a, g) => a + g._count._all, 0);
  const done = finished.find((f) => f.status === "COMPLETED")?._count._all ?? 0;
  const failed = finished.find((f) => f.status === "FAILED")?._count._all ?? 0;
  return {
    running: count(["RUNNING", "RETRY_PENDING"]),
    waiting: count(["WAITING_APPROVAL", "WAITING_EVENT", "SCHEDULED"]),
    waitingApproval: count(["WAITING_APPROVAL"]),
    needsAttention: count(["NEEDS_ATTENTION", "FAILED"]),
    completed30d: done,
    failed30d: failed,
    completionRate30d: done + failed ? Math.round((done / (done + failed)) * 1000) / 10 : null,
    avgApprovalWaitHours: approvalWaits[0]?.avg_hours !== null && approvalWaits[0]?.avg_hours !== undefined ? Math.round(approvalWaits[0].avg_hours * 10) / 10 : null,
    retries30d: retries,
    compensationFailed,
    overdueRuns: overdue.length,
    maxQueueLatencySeconds: overdue.length ? Math.round((now - Math.min(...overdue.map((o) => o.nextRunAt!.getTime()))) / 1000) : 0,
    eventLagSeconds: checkpoints.length ? Math.round((now - Math.min(...checkpoints.map((c) => c.updatedAt.getTime()))) / 1000) : null,
    byWorkflow: SM_WORKFLOW_KEYS.map((k) => ({ key: k, name: SM_WORKFLOWS[k].name, live: byStatus.filter((g) => g.workflowKey === k && !["COMPLETED", "CANCELLED"].includes(g.status)).reduce((a, g) => a + g._count._all, 0), attention: byStatus.filter((g) => g.workflowKey === k && ["NEEDS_ATTENTION", "FAILED"].includes(g.status)).reduce((a, g) => a + g._count._all, 0) })),
    limits: { retryDelaysMinutes: [1, 5, 30], eventLogRetentionDays: SM_WF_LIMITS.eventLogRetentionDays },
  };
}
