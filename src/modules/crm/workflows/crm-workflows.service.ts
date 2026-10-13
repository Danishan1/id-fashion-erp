import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { CrmEntityType, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { decryptSecret, encryptSecret } from "@/core/security/encryption";
import type { ListQuery } from "@/lib/list-query";
import type { CrmActor } from "../core/crm-actor";
import { runCrmMutation, type CrmMutationContext } from "../core/crm-mutation";
import { assertCrmEntityAccess } from "../crm-entity-access";
import { WORKFLOW_ACTIONS, UNAVAILABLE_ACTIONS, type WorkflowActionDef, type WorkflowActionKey } from "./workflow-action-catalog";
import { customFieldDefs } from "./workflow-context";
import { availableFields, canonicalJson, definitionEntities, definitionEntity, emptyDefinition, validateDefinitionStructure, workflowDefinitionSchema, type DefinitionIssue, type WorkflowDefinition } from "./workflow-definition";
import { createExecution, runExecution } from "./workflow-engine";
import { WORKFLOW_COMMON_FIELDS, WORKFLOW_ENTITIES, WORKFLOW_RECORD_FIELDS, isWorkflowEntity, type WorkflowEntity } from "./workflow-fields";
import { ACTIVE_EXECUTION_STATUSES, EXECUTION_STATUSES, NODE_TYPES, REENTRY_MODES, WORKFLOW_LIMITS, WORKFLOW_STATUSES, WORKFLOW_TRANSITIONS, type WorkflowStatusKey } from "./workflow-registry";
import { WORKFLOW_TRIGGERS, WORKFLOW_TRIGGER_KEYS, UNAVAILABLE_TRIGGERS, type WorkflowTriggerDef, type WorkflowTriggerKey } from "./workflow-triggers";
import { assertWebhookUrlShape, resolveSafeAddress, WebhookBlockedError } from "./workflow-webhook";
import {
  createWorkflowSchema,
  duplicateSchema,
  lifecycleSchema,
  manualRunSchema,
  publishSchema,
  saveDraftSchema,
  testRunSchema,
  updateWorkflowSchema,
  type ExecutionFilters,
  type WorkflowFilters,
} from "./workflow.schema";

/**
 * Phase 18 — workflow management: create, edit the draft, validate, publish
 * (immutable versions), pause / resume / disable / archive, duplicate, test
 * (dry run), manual start, and the execution history.
 *
 * Permissions (existing ERP RBAC, no new system): reading workflows and
 * executions = crm_settings.view; changing them = crm_settings.edit. A
 * workflow runs as the user who published it (its execution identity): every
 * action re-checks that user's live ERP permissions and record visibility.
 */

const TABLE = "crm_workflows";

type WorkflowRow = Prisma.CrmWorkflowGetPayload<{ include: { draftVersion: true; publishedVersion: true } }>;

function conflict(id: string): BusinessRuleError {
  return new BusinessRuleError("RECORD_VERSION_CONFLICT", "This workflow was changed by someone else. Reload to see the latest version, then try again.", { id });
}

function hashDefinition(def: WorkflowDefinition): string {
  return createHash("sha256").update(canonicalJson(def)).digest("hex");
}

async function loadWorkflow(companyId: string, id: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<WorkflowRow> {
  const w = await db.crmWorkflow.findFirst({ where: { id, companyId }, include: { draftVersion: true, publishedVersion: true } });
  if (!w) throw new BusinessRuleError("NOT_FOUND", "Workflow not found.", { id });
  return w;
}

function emit(ctx: CrmMutationContext, w: { id: string; name: string }, eventType: Parameters<CrmMutationContext["emit"]>[0]["eventType"], summary?: string, payload?: Record<string, unknown>) {
  ctx.emit({ entityType: "WORKFLOW", entityId: w.id, eventType, summary: summary ?? w.name, payload });
}

async function versionedUpdate(ctx: CrmMutationContext, w: WorkflowRow, expected: number | undefined, data: Prisma.CrmWorkflowUncheckedUpdateManyInput, actor: CrmActor) {
  const { count } = await ctx.tx.crmWorkflow.updateMany({ where: { id: w.id, companyId: actor.companyId, ...(expected !== undefined ? { version: expected } : {}) }, data: { ...data, version: { increment: 1 }, updatedByUserId: actor.userId } });
  if (!count) throw conflict(w.id);
}

function parseDefinition(json: unknown): WorkflowDefinition {
  return workflowDefinitionSchema.parse(json);
}

// ── Presentation ────────────────────────────────────────────────

function triggerLabel(key: string | null): string {
  return key && key in WORKFLOW_TRIGGERS ? (WORKFLOW_TRIGGERS[key as WorkflowTriggerKey] as WorkflowTriggerDef).label : key ?? "—";
}

async function userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!unique.length) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } });
  return new Map(rows.map((r) => [r.id, r.fullName]));
}

function presentVersion(v: { id: string; versionNumber: number; status: string; definition: Prisma.JsonValue; changeNote: string | null; createdAt: Date; updatedAt: Date; publishedAt: Date | null; createdByUserId: string; publishedByUserId: string | null }, names: Map<string, string>) {
  return {
    id: v.id,
    versionNumber: v.versionNumber,
    status: v.status,
    definition: v.definition as unknown as WorkflowDefinition,
    changeNote: v.changeNote,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    publishedAt: v.publishedAt,
    createdBy: { id: v.createdByUserId, name: names.get(v.createdByUserId) ?? null },
    publishedBy: v.publishedByUserId ? { id: v.publishedByUserId, name: names.get(v.publishedByUserId) ?? null } : null,
  };
}

async function executionStats(workflowIds: string[]) {
  if (!workflowIds.length) return new Map<string, { active: number; completed: number; failed: number; total: number }>();
  const rows = await prisma.crmWorkflowExecution.groupBy({ by: ["workflowId", "status"], where: { workflowId: { in: workflowIds }, mode: "LIVE" }, _count: { _all: true } });
  const out = new Map<string, { active: number; completed: number; failed: number; total: number }>();
  for (const r of rows) {
    const s = out.get(r.workflowId) ?? { active: 0, completed: 0, failed: 0, total: 0 };
    s.total += r._count._all;
    if (ACTIVE_EXECUTION_STATUSES.includes(r.status)) s.active += r._count._all;
    if (r.status === "COMPLETED") s.completed += r._count._all;
    if (r.status === "FAILED") s.failed += r._count._all;
    out.set(r.workflowId, s);
  }
  return out;
}

// ── Reading ─────────────────────────────────────────────────────

export async function listWorkflows(actor: CrmActor, filters: WorkflowFilters, query: ListQuery) {
  const where: Prisma.CrmWorkflowWhereInput = {
    companyId: actor.companyId,
    ...(filters.statuses?.length ? { status: { in: filters.statuses } } : { status: { not: "ARCHIVED" } }),
    ...(filters.triggers?.length ? { triggerType: { in: filters.triggers } } : {}),
    ...(query.search ? { OR: [{ name: { contains: query.search, mode: "insensitive" } }, { description: { contains: query.search, mode: "insensitive" } }] } : {}),
  };
  const sortable = new Set(["name", "status", "updatedAt", "createdAt", "lastTriggeredAt", "publishedAt"]);
  const orderBy = { [sortable.has(query.sortBy) ? query.sortBy : "updatedAt"]: query.sortOrder } as Prisma.CrmWorkflowOrderByWithRelationInput;
  const [rows, totalCount] = await Promise.all([
    prisma.crmWorkflow.findMany({ where, orderBy: [orderBy, { id: "asc" }], skip: query.skip, take: query.take, include: { publishedVersion: { select: { versionNumber: true } }, draftVersion: { select: { versionNumber: true } } } }),
    prisma.crmWorkflow.count({ where }),
  ]);
  const [stats, names] = await Promise.all([executionStats(rows.map((r) => r.id)), userNames(rows.flatMap((r) => [r.updatedByUserId ?? r.createdByUserId, r.runAsUserId]))]);
  return {
    totalCount,
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      status: r.status,
      statusLabel: WORKFLOW_STATUSES[r.status].label,
      triggerType: r.triggerType,
      triggerLabel: triggerLabel(r.triggerType),
      publishedVersionNumber: r.publishedVersion?.versionNumber ?? null,
      hasDraft: Boolean(r.draftVersionId),
      draftVersionNumber: r.draftVersion?.versionNumber ?? null,
      runAs: r.runAsUserId ? { id: r.runAsUserId, name: names.get(r.runAsUserId) ?? null } : null,
      lastTriggeredAt: r.lastTriggeredAt,
      publishedAt: r.publishedAt,
      updatedAt: r.updatedAt,
      updatedBy: { name: names.get(r.updatedByUserId ?? r.createdByUserId) ?? null },
      stats: stats.get(r.id) ?? { active: 0, completed: 0, failed: 0, total: 0 },
    })),
  };
}

export async function getWorkflow(actor: CrmActor, id: string) {
  const w = await loadWorkflow(actor.companyId, id);
  const names = await userNames([w.createdByUserId, w.updatedByUserId, w.runAsUserId, w.publishedByUserId, w.draftVersion?.createdByUserId, w.publishedVersion?.createdByUserId, w.publishedVersion?.publishedByUserId]);
  const stats = (await executionStats([w.id])).get(w.id) ?? { active: 0, completed: 0, failed: 0, total: 0 };
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    status: w.status,
    statusLabel: WORKFLOW_STATUSES[w.status].label,
    version: w.version,
    triggerType: w.triggerType,
    triggerLabel: triggerLabel(w.triggerType),
    runAs: w.runAsUserId ? { id: w.runAsUserId, name: names.get(w.runAsUserId) ?? null } : null,
    hasWebhookSecret: Boolean(w.webhookSecretEnc),
    draft: w.draftVersion ? presentVersion(w.draftVersion, names) : null,
    published: w.publishedVersion ? presentVersion(w.publishedVersion, names) : null,
    lastTriggeredAt: w.lastTriggeredAt,
    publishedAt: w.publishedAt,
    publishedBy: w.publishedByUserId ? { id: w.publishedByUserId, name: names.get(w.publishedByUserId) ?? null } : null,
    createdAt: w.createdAt,
    createdBy: { id: w.createdByUserId, name: names.get(w.createdByUserId) ?? null },
    updatedAt: w.updatedAt,
    stats,
    allowedTransitions: WORKFLOW_TRANSITIONS[w.status],
  };
}

export async function listVersions(actor: CrmActor, id: string) {
  await loadWorkflow(actor.companyId, id);
  const rows = await prisma.crmWorkflowVersion.findMany({ where: { workflowId: id, companyId: actor.companyId }, orderBy: { versionNumber: "desc" } });
  const names = await userNames(rows.flatMap((r) => [r.createdByUserId, r.publishedByUserId]));
  const counts = await prisma.crmWorkflowExecution.groupBy({ by: ["workflowVersionId"], where: { workflowId: id, mode: "LIVE" }, _count: { _all: true } });
  const byVersion = new Map(counts.map((c) => [c.workflowVersionId, c._count._all]));
  return rows.map((r) => ({ ...presentVersion(r, names), executions: byVersion.get(r.id) ?? 0 }));
}

export async function getVersion(actor: CrmActor, id: string, versionId: string) {
  const v = await prisma.crmWorkflowVersion.findFirst({ where: { id: versionId, workflowId: id, companyId: actor.companyId } });
  if (!v) throw new BusinessRuleError("NOT_FOUND", "Version not found.", { versionId });
  return presentVersion(v, await userNames([v.createdByUserId, v.publishedByUserId]));
}

// ── Creating & editing ──────────────────────────────────────────

export async function createWorkflow(actor: CrmActor, raw: unknown) {
  const input = createWorkflowSchema.parse(raw);
  const definition = emptyDefinition(input.trigger);
  if (input.trigger === "manual") {
    if (!isWorkflowEntity(input.entityType)) throw new BusinessRuleError("VALIDATION_ERROR", "Choose the record type a manual workflow runs on.", { fieldErrors: { entityType: "Choose a record type." } });
    definition.trigger.entityType = input.entityType;
  }
  return runCrmMutation(actor, async (ctx) => {
    const id = randomUUID();
    const versionId = randomUUID();
    await ctx.tx.crmWorkflow.create({
      data: { id, companyId: actor.companyId, name: input.name, description: input.description || null, status: "DRAFT", triggerType: input.trigger, createdByUserId: actor.userId, webhookSecretEnc: encryptSecret(randomBytes(32).toString("hex")) },
    });
    await ctx.tx.crmWorkflowVersion.create({ data: { id: versionId, companyId: actor.companyId, workflowId: id, versionNumber: 1, status: "DRAFT", triggerType: input.trigger, definition: definition as unknown as Prisma.InputJsonValue, definitionHash: hashDefinition(definition), createdByUserId: actor.userId } });
    await ctx.tx.crmWorkflow.update({ where: { id }, data: { draftVersionId: versionId } });
    await ctx.audit({ tableName: TABLE, recordId: id, action: "CREATE", newValues: { name: input.name, trigger: input.trigger } });
    emit(ctx, { id, name: input.name }, "workflow.created", `${input.name} · ${triggerLabel(input.trigger)}`, { trigger: input.trigger });
    return { id };
  });
}

export async function updateWorkflow(actor: CrmActor, id: string, raw: unknown) {
  const input = updateWorkflowSchema.parse(raw);
  const w = await loadWorkflow(actor.companyId, id);
  if (w.status === "ARCHIVED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this workflow before editing it.");
  await runCrmMutation(actor, async (ctx) => {
    await versionedUpdate(ctx, w, input.version, { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.description !== undefined ? { description: input.description || null } : {}) }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { name: w.name, description: w.description }, newValues: { name: input.name ?? w.name, description: input.description ?? w.description } });
    emit(ctx, w, "workflow.updated");
  });
  return getWorkflow(actor, id);
}

/**
 * Saves the editable draft. A published workflow with no draft gets a new
 * draft version (next number) — the published version is never touched.
 * Drafts may be incomplete: structural issues are returned, not thrown.
 */
export async function saveDraft(actor: CrmActor, id: string, raw: unknown) {
  const input = saveDraftSchema.parse(raw);
  const w = await loadWorkflow(actor.companyId, id);
  if (w.status === "ARCHIVED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this workflow before editing it.");
  const definition = input.definition;
  const hash = hashDefinition(definition);
  await runCrmMutation(actor, async (ctx) => {
    if (w.draftVersion) {
      await ctx.tx.crmWorkflowVersion.update({ where: { id: w.draftVersion.id }, data: { definition: definition as unknown as Prisma.InputJsonValue, definitionHash: hash, triggerType: definition.trigger.type, changeNote: input.changeNote ?? w.draftVersion.changeNote } });
      await versionedUpdate(ctx, w, input.version, w.publishedVersionId ? {} : { triggerType: definition.trigger.type }, actor);
    } else {
      const max = await ctx.tx.crmWorkflowVersion.aggregate({ where: { workflowId: id }, _max: { versionNumber: true } });
      const versionId = randomUUID();
      await ctx.tx.crmWorkflowVersion.create({ data: { id: versionId, companyId: actor.companyId, workflowId: id, versionNumber: (max._max.versionNumber ?? 0) + 1, status: "DRAFT", triggerType: definition.trigger.type, definition: definition as unknown as Prisma.InputJsonValue, definitionHash: hash, changeNote: input.changeNote ?? null, createdByUserId: actor.userId } });
      await versionedUpdate(ctx, w, input.version, { draftVersionId: versionId }, actor);
    }
    await ctx.audit({ tableName: "crm_workflow_versions", recordId: w.draftVersionId ?? id, action: "UPDATE", newValues: { definitionHash: hash, nodes: definition.nodes.length, trigger: definition.trigger.type } });
    emit(ctx, w, "workflow.draft_saved", `${w.name} · ${definition.nodes.length} step(s)`);
  });
  const custom = await customFieldDefs(actor.companyId, definitionEntity(definition));
  return { workflow: await getWorkflow(actor, id), issues: validateDefinitionStructure(definition, custom) };
}

export async function discardDraft(actor: CrmActor, id: string, raw: unknown) {
  const { version } = lifecycleSchema.parse(raw);
  const w = await loadWorkflow(actor.companyId, id);
  if (!w.draftVersion) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "There is no draft to discard.");
  if (!w.publishedVersionId) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This workflow has never been published — its draft is all there is. Archive the workflow instead.");
  await runCrmMutation(actor, async (ctx) => {
    await versionedUpdate(ctx, w, version, { draftVersionId: null }, actor);
    await ctx.tx.crmWorkflowVersion.delete({ where: { id: w.draftVersion!.id } });
    await ctx.audit({ tableName: "crm_workflow_versions", recordId: w.draftVersion!.id, action: "DELETE", oldValues: { versionNumber: w.draftVersion!.versionNumber } });
    emit(ctx, w, "workflow.draft_discarded", `v${w.draftVersion!.versionNumber} discarded`);
  });
  return getWorkflow(actor, id);
}

// ── Validation ──────────────────────────────────────────────────

/**
 * Full validation: structure (client-shared) + server checks — referenced
 * statuses / stages / tags / users / templates exist and are usable, webhook
 * URLs are allowed, and the run-as user (whoever publishes) holds every
 * permission the actions need.
 */
export async function validateDefinitionForPublish(actor: CrmActor, definition: WorkflowDefinition): Promise<{ errors: DefinitionIssue[]; warnings: DefinitionIssue[] }> {
  const entity = definitionEntity(definition);
  const custom = await customFieldDefs(actor.companyId, entity);
  const errors = validateDefinitionStructure(definition, custom);
  const warnings: DefinitionIssue[] = [];
  const companyId = actor.companyId;
  const ids = { leadStatus: new Set<string>(), companyStatus: new Set<string>(), stage: new Set<string>(), tag: new Set<string>(), user: new Set<string>(), template: new Set<string>() };
  const perms = new Map<string, WorkflowActionDef>();
  for (const n of definition.nodes) {
    if (n.type !== "ACTION" || !(n.action in WORKFLOW_ACTIONS)) continue;
    const def = WORKFLOW_ACTIONS[n.action as WorkflowActionKey] as WorkflowActionDef;
    perms.set(`${def.permission.module}.${def.permission.action}`, def);
    const p = n.params as Record<string, unknown>;
    for (const param of def.params) {
      const v = p[param.key];
      const add = (set: Set<string>) => (Array.isArray(v) ? v : [v]).forEach((x) => typeof x === "string" && x && set.add(x));
      if (param.type === "leadStatus") add(ids.leadStatus);
      if (param.type === "companyStatus") add(ids.companyStatus);
      if (param.type === "stage") add(ids.stage);
      if (param.type === "tags") add(ids.tag);
      if (param.type === "user" || param.type === "users") add(ids.user);
      if (param.type === "template") add(ids.template);
      if (param.type === "url" && typeof v === "string") {
        try {
          await resolveSafeAddress(assertWebhookUrlShape(v));
        } catch (e) {
          errors.push({ path: `nodes.${n.id}.params.${param.key}`, nodeId: n.id, message: e instanceof WebhookBlockedError ? e.message : "The webhook URL can't be reached." });
        }
      }
    }
    if (n.action === "message.send" && entity && entity !== "CONVERSATION") warnings.push({ path: `nodes.${n.id}`, nodeId: n.id, message: "Messages go to the contact's latest conversation on the template's channel; records without one fail this step." });
  }
  const check = async (label: string, wanted: Set<string>, found: Promise<{ id: string }[]>) => {
    if (!wanted.size) return;
    const have = new Set((await found).map((r) => r.id));
    for (const id of wanted) if (!have.has(id)) errors.push({ path: "nodes", message: `A step uses a ${label} that no longer exists or is inactive (${id}).` });
  };
  await Promise.all([
    check("lead status", ids.leadStatus, prisma.crmLeadStatus.findMany({ where: { companyId, id: { in: [...ids.leadStatus] }, isActive: true }, select: { id: true } })),
    check("company status", ids.companyStatus, prisma.crmCompanyStatus.findMany({ where: { companyId, id: { in: [...ids.companyStatus] }, isActive: true }, select: { id: true } })),
    check("stage", ids.stage, prisma.crmPipelineStage.findMany({ where: { companyId, id: { in: [...ids.stage] }, archivedAt: null }, select: { id: true } })),
    check("tag", ids.tag, prisma.crmTag.findMany({ where: { companyId, id: { in: [...ids.tag] } }, select: { id: true } })),
    check("user", ids.user, prisma.user.findMany({ where: { companyId, id: { in: [...ids.user] }, status: "ACTIVE" }, select: { id: true } })),
    check("active message template", ids.template, prisma.crmMessageTemplate.findMany({ where: { companyId, id: { in: [...ids.template] }, status: "ACTIVE" }, select: { id: true } })),
  ]);
  // The publisher becomes the run-as user: they must hold every permission the actions need.
  for (const [key, def] of perms) {
    const [module, action] = key.split(".") as ["crm" | "crm_settings", "view" | "edit" | "create"];
    if (!(await PermissionService.can(actor.userId, module, action))) errors.push({ path: "runAs", message: `You'll be the run-as user, but you don't have ${key} — needed for "${def.label}".` });
  }
  if (!(await PermissionService.can(actor.userId, "crm", "view_all"))) warnings.push({ path: "runAs", message: "You don't have crm.view_all: the workflow will only act on records you can see (yours, or unassigned ones you created)." });
  if (definition.settings.reentry === "ALWAYS") warnings.push({ path: "settings.reentry", message: `"Every time" lets runs overlap on the same record (at most ${WORKFLOW_LIMITS.maxStartsPerRecordPerHour} per hour per record).` });
  return { errors, warnings };
}

export async function validateWorkflow(actor: CrmActor, id: string) {
  const w = await loadWorkflow(actor.companyId, id);
  const version = w.draftVersion ?? w.publishedVersion;
  if (!version) throw new BusinessRuleError("NOT_FOUND", "This workflow has no version.");
  const definition = parseDefinition(version.definition);
  const { errors, warnings } = await validateDefinitionForPublish(actor, definition);
  return { valid: !errors.length, errors, warnings, versionId: version.id, versionNumber: version.versionNumber };
}

// ── Lifecycle ───────────────────────────────────────────────────

/**
 * Publishes the draft: it becomes the immutable live version (the previous
 * one is SUPERSEDED — executions already running keep their own version), the
 * workflow becomes Active and the publisher becomes its run-as user.
 */
export async function publishWorkflow(actor: CrmActor, id: string, raw: unknown) {
  const input = publishSchema.parse(raw);
  const w = await loadWorkflow(actor.companyId, id);
  if (w.status === "ARCHIVED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this workflow before publishing it.");
  if (!w.draftVersion) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "There are no changes to publish.");
  const definition = parseDefinition(w.draftVersion.definition);
  const { errors, warnings } = await validateDefinitionForPublish(actor, definition);
  if (errors.length) throw new BusinessRuleError("CRM_WORKFLOW_INVALID", `Fix ${errors.length} problem(s) before publishing.`, { errors, warnings });
  const now = new Date();
  await runCrmMutation(actor, async (ctx) => {
    await versionedUpdate(ctx, w, input.version, { status: "PUBLISHED", publishedVersionId: null, draftVersionId: null, triggerType: definition.trigger.type, runAsUserId: actor.userId, publishedAt: now, publishedByUserId: actor.userId, pausedAt: null, disabledAt: null }, actor);
    if (w.publishedVersionId) await ctx.tx.crmWorkflowVersion.update({ where: { id: w.publishedVersionId }, data: { status: "SUPERSEDED" } });
    await ctx.tx.crmWorkflowVersion.update({ where: { id: w.draftVersion!.id }, data: { status: "PUBLISHED", publishedAt: now, publishedByUserId: actor.userId, ...(input.changeNote ? { changeNote: input.changeNote } : {}) } });
    await ctx.tx.crmWorkflow.update({ where: { id }, data: { publishedVersionId: w.draftVersion!.id } });
    await ctx.audit({ tableName: TABLE, recordId: id, action: "POST", oldValues: { status: w.status, publishedVersionId: w.publishedVersionId }, newValues: { status: "PUBLISHED", publishedVersionId: w.draftVersion!.id, versionNumber: w.draftVersion!.versionNumber, runAsUserId: actor.userId } });
    emit(ctx, w, "workflow.published", `v${w.draftVersion!.versionNumber} published`, { versionId: w.draftVersion!.id, versionNumber: w.draftVersion!.versionNumber, warnings: warnings.length });
  });
  return { workflow: await getWorkflow(actor, id), warnings };
}

const LIFECYCLE_EVENT: Record<WorkflowStatusKey, Parameters<CrmMutationContext["emit"]>[0]["eventType"]> = {
  PAUSED: "workflow.paused",
  PUBLISHED: "workflow.resumed",
  DISABLED: "workflow.disabled",
  ARCHIVED: "workflow.archived",
  DRAFT: "workflow.restored",
};

/**
 * PAUSED: new triggers ignored; running executions hold (resume continues them).
 * DISABLED: new triggers ignored; queued / waiting / paused executions are cancelled.
 * ARCHIVED: as disabled, and hidden from the list. Restore brings it back as a draft.
 * PUBLISHED (from paused / disabled): back on; paused executions continue.
 */
export async function changeWorkflowStatus(actor: CrmActor, id: string, to: WorkflowStatusKey, raw: unknown) {
  const { version } = lifecycleSchema.parse(raw);
  const w = await loadWorkflow(actor.companyId, id);
  if (!WORKFLOW_TRANSITIONS[w.status].includes(to)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `A ${WORKFLOW_STATUSES[w.status].label.toLowerCase()} workflow can't be ${WORKFLOW_STATUSES[to].label.toLowerCase()}.`, { from: w.status, to });
  if (to === "PUBLISHED" && !w.publishedVersionId) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Publish the workflow first.");
  if (to === "PUBLISHED" && w.runAsUserId && !(await PermissionService.can(w.runAsUserId, "crm", "view"))) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The run-as user is no longer active. Publish the workflow again to run it as you.");
  const now = new Date();
  let cancelled = 0;
  await runCrmMutation(actor, async (ctx) => {
    await versionedUpdate(ctx, w, version, { status: to, ...(to === "PAUSED" ? { pausedAt: now } : {}), ...(to === "DISABLED" ? { disabledAt: now } : {}), ...(to === "ARCHIVED" ? { archivedAt: now } : {}), ...(to === "PUBLISHED" ? { pausedAt: null, disabledAt: null } : {}), ...(to === "DRAFT" ? { archivedAt: null } : {}) }, actor);
    if (to === "DISABLED" || to === "ARCHIVED") {
      const r = await ctx.tx.crmWorkflowExecution.updateMany({ where: { workflowId: id, status: { in: ["QUEUED", "WAITING", "PAUSED"] } }, data: { status: "CANCELLED", outcome: "CANCELLED", exitReason: `Workflow ${to.toLowerCase()}.`, finishedAt: now, nextRunAt: null } });
      cancelled = r.count;
    }
    if (to === "PUBLISHED") await ctx.tx.crmWorkflowExecution.updateMany({ where: { workflowId: id, status: "PAUSED" }, data: { status: "WAITING" } });
    if (to === "DRAFT" && w.publishedVersionId) {
      // Restored from the archive: it must be re-published to run again.
      await ctx.tx.crmWorkflow.update({ where: { id }, data: { status: "DRAFT" } });
    }
    await ctx.audit({ tableName: TABLE, recordId: id, action: to === "ARCHIVED" ? "CANCEL" : "UPDATE", oldValues: { status: w.status }, newValues: { status: to, cancelledExecutions: cancelled } });
    emit(ctx, w, LIFECYCLE_EVENT[to], `${WORKFLOW_STATUSES[w.status].label} → ${WORKFLOW_STATUSES[to].label}${cancelled ? ` · ${cancelled} execution(s) cancelled` : ""}`, { from: w.status, to, cancelledExecutions: cancelled });
  });
  return getWorkflow(actor, id);
}

export async function duplicateWorkflow(actor: CrmActor, id: string, raw: unknown) {
  const input = duplicateSchema.parse(raw ?? {});
  const w = await loadWorkflow(actor.companyId, id);
  const source = w.draftVersion ?? w.publishedVersion;
  if (!source) throw new BusinessRuleError("NOT_FOUND", "Nothing to duplicate.");
  const definition = parseDefinition(source.definition);
  const name = input.name ?? `Copy of ${w.name}`.slice(0, 120);
  return runCrmMutation(actor, async (ctx) => {
    const newId = randomUUID();
    const versionId = randomUUID();
    await ctx.tx.crmWorkflow.create({ data: { id: newId, companyId: actor.companyId, name, description: w.description, status: "DRAFT", triggerType: definition.trigger.type, createdByUserId: actor.userId, webhookSecretEnc: encryptSecret(randomBytes(32).toString("hex")) } });
    await ctx.tx.crmWorkflowVersion.create({ data: { id: versionId, companyId: actor.companyId, workflowId: newId, versionNumber: 1, status: "DRAFT", triggerType: definition.trigger.type, definition: definition as unknown as Prisma.InputJsonValue, definitionHash: hashDefinition(definition), changeNote: `Copied from ${w.name} v${source.versionNumber}`, createdByUserId: actor.userId } });
    await ctx.tx.crmWorkflow.update({ where: { id: newId }, data: { draftVersionId: versionId } });
    await ctx.audit({ tableName: TABLE, recordId: newId, action: "CREATE", newValues: { name, duplicatedFrom: id } });
    emit(ctx, { id: newId, name }, "workflow.duplicated", `Copy of ${w.name} (v${source.versionNumber})`, { sourceWorkflowId: id });
    return { id: newId };
  });
}

/** The HMAC secret webhook receivers verify signatures with (crm_settings.edit only). */
export async function revealWebhookSecret(actor: CrmActor, id: string) {
  const w = await loadWorkflow(actor.companyId, id);
  if (!w.webhookSecretEnc) throw new BusinessRuleError("NOT_FOUND", "This workflow has no webhook secret.");
  // Who looked at the secret is audited (the value never is).
  await runCrmMutation(actor, (ctx) => ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", newValues: { webhookSecret: "revealed" } }));
  return { secret: decryptSecret(w.webhookSecretEnc) };
}

export async function rotateWebhookSecret(actor: CrmActor, id: string) {
  const w = await loadWorkflow(actor.companyId, id);
  const secret = randomBytes(32).toString("hex");
  await runCrmMutation(actor, async (ctx) => {
    await versionedUpdate(ctx, w, undefined, { webhookSecretEnc: encryptSecret(secret) }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", newValues: { webhookSecret: "rotated" } });
    emit(ctx, w, "workflow.secret_rotated");
  });
  return { secret };
}

// ── Test & manual runs ──────────────────────────────────────────

async function assertRunnableRecord(actor: CrmActor, definition: WorkflowDefinition, entityTypeRaw: string, entityId: string): Promise<WorkflowEntity> {
  if (!isWorkflowEntity(entityTypeRaw)) throw new BusinessRuleError("VALIDATION_ERROR", "Choose a record.", { fieldErrors: { entityType: "Unknown record type." } });
  const allowed = definitionEntities(definition);
  if (!allowed.includes(entityTypeRaw)) throw new BusinessRuleError("VALIDATION_ERROR", `This workflow runs on ${allowed.map((e) => WORKFLOW_ENTITIES[e].plural.toLowerCase()).join(" / ") || "no records yet (choose a trigger)"}.`);
  // The person testing / starting must be able to see the record.
  await assertCrmEntityAccess(actor, entityTypeRaw as CrmEntityType, entityId);
  return entityTypeRaw;
}

/**
 * Test mode: a dry run of the draft (or the published version) on a real
 * record. Conditions are evaluated for real; every action only reports what
 * it would do; waits are skipped. Nothing is changed, sent or called — the
 * execution is stored with mode TEST and never counted as a live run. The
 * tester is the identity for reads (record visibility, template rendering).
 */
export async function testWorkflow(actor: CrmActor, id: string, raw: unknown) {
  const input = testRunSchema.parse(raw);
  const w = await loadWorkflow(actor.companyId, id);
  const version = input.source === "published" ? w.publishedVersion : (w.draftVersion ?? w.publishedVersion);
  if (!version) throw new BusinessRuleError("NOT_FOUND", input.source === "published" ? "This workflow isn't published." : "This workflow has no version to test.");
  const definition = parseDefinition(version.definition);
  const structural = validateDefinitionStructure(definition, await customFieldDefs(actor.companyId, definitionEntity(definition)));
  if (structural.length) throw new BusinessRuleError("CRM_WORKFLOW_INVALID", `Fix ${structural.length} problem(s) before testing.`, { errors: structural, warnings: [] });
  const entityType = await assertRunnableRecord(actor, definition, input.entityType, input.entityId);
  const created = await createExecution({
    companyId: actor.companyId,
    workflow: { id: w.id, name: w.name, runAsUserId: actor.userId },
    versionId: version.id,
    triggerType: definition.trigger.type,
    entityType,
    entityId: input.entityId,
    idempotencyKey: `test:${randomUUID()}`,
    trigger: { eventId: null, eventType: "test", payload: input.triggerPayload ?? {}, actorUserId: actor.userId, correlationId: null, occurredAt: new Date().toISOString() },
    mode: "TEST",
    startedByUserId: actor.userId,
    runAsUserId: actor.userId,
  });
  if (!created) throw new BusinessRuleError("REQUEST_IN_PROGRESS", "Couldn't start the test. Try again.");
  // Trigger conditions are reported (a test always runs, so you can see the steps).
  const enrol = definition.trigger.conditions?.conditions.length ? await enrolmentCheck(actor.companyId, definition, entityType, input.entityId, input.triggerPayload ?? {}) : null;
  // Tests run to the end in one go (waits are simulated) — loop over yields.
  for (let i = 0; i < 10; i++) {
    const r = await runExecution(created.id, { force: true });
    if (!r || r.status !== "QUEUED") break;
  }
  return { execution: await getExecution(actor, created.id), enrolment: enrol };
}

async function enrolmentCheck(companyId: string, definition: WorkflowDefinition, entityType: WorkflowEntity, entityId: string, payload: Record<string, unknown>) {
  const { evaluateGroup, explainGroup } = await import("./workflow-conditions");
  const { loadRecordSnapshot, buildConditionSnapshot } = await import("./workflow-context");
  const snap = buildConditionSnapshot(await loadRecordSnapshot(companyId, entityType, entityId), { payload });
  const labels = new Map([...availableFields(definition, await customFieldDefs(companyId, definitionEntity(definition))).values()].map((f) => [f.key, f.label]));
  return { wouldEnrol: evaluateGroup(definition.trigger.conditions, snap), explanation: explainGroup(definition.trigger.conditions, snap, labels) };
}

/** Starts a published workflow on a record now (any trigger; useful for manual workflows and re-runs). */
export async function runWorkflowManually(actor: CrmActor, id: string, raw: unknown) {
  const input = manualRunSchema.parse(raw);
  const w = await loadWorkflow(actor.companyId, id);
  if (w.status !== "PUBLISHED" || !w.publishedVersion) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only an active (published) workflow can be started.");
  const definition = parseDefinition(w.publishedVersion.definition);
  const entityType = await assertRunnableRecord(actor, definition, input.entityType, input.entityId);
  if (definition.settings.reentry !== "ALWAYS") {
    const active = await prisma.crmWorkflowExecution.findFirst({ where: { workflowId: id, entityId: input.entityId, mode: "LIVE", ...(definition.settings.reentry === "AFTER_FINISH" ? { status: { in: ACTIVE_EXECUTION_STATUSES } } : {}) }, select: { id: true } });
    if (active) throw new BusinessRuleError("INVALID_STATE_TRANSITION", definition.settings.reentry === "ONCE" ? "This record has already been through this workflow (it runs once per record)." : "This record is already in this workflow.", { executionId: active.id });
  }
  const created = await createExecution({
    companyId: actor.companyId,
    workflow: { id: w.id, name: w.name, runAsUserId: w.runAsUserId },
    versionId: w.publishedVersion.id,
    triggerType: "manual",
    entityType,
    entityId: input.entityId,
    idempotencyKey: `manual:${randomUUID()}`,
    trigger: { eventId: null, eventType: "manual", payload: {}, actorUserId: actor.userId, correlationId: null, occurredAt: new Date().toISOString() },
    startedByUserId: actor.userId,
  });
  if (!created) throw new BusinessRuleError("REQUEST_IN_PROGRESS", "Couldn't start the workflow. Try again.");
  await runCrmMutation(actor, async (ctx) => {
    await ctx.audit({ tableName: "crm_workflow_executions", recordId: created.id, action: "CREATE", newValues: { workflowId: id, entityType, entityId: input.entityId, manual: true } });
    emit(ctx, w, "workflow.execution_started", `Started manually`, { executionId: created.id, entityType, entityId: input.entityId });
  });
  await runExecution(created.id);
  return getExecution(actor, created.id);
}

// ── Executions ──────────────────────────────────────────────────

async function recordLabels(rows: { entityType: CrmEntityType | null; entityId: string | null }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = (t: CrmEntityType) => [...new Set(rows.filter((r) => r.entityType === t && r.entityId).map((r) => r.entityId!))];
  const [leads, contacts, companies, opps, acts, convs] = await Promise.all([
    prisma.crmLead.findMany({ where: { id: { in: ids("LEAD") } }, select: { id: true, fullName: true, leadNumber: true } }),
    prisma.crmContact.findMany({ where: { id: { in: ids("CONTACT") } }, select: { id: true, fullName: true } }),
    prisma.crmCompany.findMany({ where: { id: { in: ids("COMPANY") } }, select: { id: true, name: true } }),
    prisma.crmOpportunity.findMany({ where: { id: { in: ids("OPPORTUNITY") } }, select: { id: true, name: true, opportunityNumber: true } }),
    prisma.crmActivity.findMany({ where: { id: { in: ids("ACTIVITY") } }, select: { id: true, subject: true } }),
    prisma.crmConversation.findMany({ where: { id: { in: ids("CONVERSATION") } }, select: { id: true, displayName: true, displayIdentifier: true } }),
  ]);
  leads.forEach((r) => out.set(r.id, `${r.leadNumber} · ${r.fullName}`));
  contacts.forEach((r) => out.set(r.id, r.fullName));
  companies.forEach((r) => out.set(r.id, r.name));
  opps.forEach((r) => out.set(r.id, `${r.opportunityNumber} · ${r.name}`));
  acts.forEach((r) => out.set(r.id, r.subject));
  convs.forEach((r) => out.set(r.id, r.displayName ?? r.displayIdentifier ?? "Conversation"));
  return out;
}

const RECORD_PATH: Partial<Record<CrmEntityType, string>> = { LEAD: "/crm/leads", CONTACT: "/crm/contacts", COMPANY: "/crm/companies", OPPORTUNITY: "/crm/opportunities", ACTIVITY: "/crm/activities", CONVERSATION: "/crm/inbox" };

function presentExecution(r: Prisma.CrmWorkflowExecutionGetPayload<{ include: { workflow: { select: { name: true } }; workflowVersion: { select: { versionNumber: true } } } }>, labels: Map<string, string>, names: Map<string, string>) {
  return {
    id: r.id,
    workflow: { id: r.workflowId, name: r.workflow.name },
    versionNumber: r.workflowVersion.versionNumber,
    status: r.status,
    statusLabel: EXECUTION_STATUSES[r.status].label,
    mode: r.mode,
    triggerType: r.triggerType,
    triggerLabel: triggerLabel(r.triggerType),
    triggerEventId: r.triggerEventId,
    record: r.entityType && r.entityId ? { entityType: r.entityType, entityId: r.entityId, label: labels.get(r.entityId) ?? "Deleted record", href: RECORD_PATH[r.entityType] ? `${RECORD_PATH[r.entityType]}/${r.entityId}` : null } : null,
    depth: r.depth,
    parentExecutionId: r.parentExecutionId,
    currentNodeId: r.currentNodeId,
    nextRunAt: r.nextRunAt,
    stepCount: r.stepCount,
    retryCount: r.retryCount,
    outcome: r.outcome,
    exitReason: r.exitReason,
    error: r.errorCode || r.errorMessage ? { code: r.errorCode, message: r.errorMessage } : null,
    runAs: r.runAsUserId ? { id: r.runAsUserId, name: names.get(r.runAsUserId) ?? null } : null,
    startedBy: r.startedByUserId ? { id: r.startedByUserId, name: names.get(r.startedByUserId) ?? null } : null,
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  };
}

export async function listExecutions(actor: CrmActor, filters: ExecutionFilters, query: ListQuery) {
  const where: Prisma.CrmWorkflowExecutionWhereInput = {
    companyId: actor.companyId,
    mode: filters.mode ?? "LIVE",
    ...(filters.workflowId ? { workflowId: filters.workflowId } : {}),
    ...(filters.statuses?.length ? { status: { in: filters.statuses } } : {}),
    ...(filters.entityType && isWorkflowEntity(filters.entityType) ? { entityType: filters.entityType } : {}),
    ...(filters.entityId ? { entityId: filters.entityId } : {}),
  };
  const sortable = new Set(["createdAt", "finishedAt", "status", "nextRunAt"]);
  const orderBy = { [sortable.has(query.sortBy) ? query.sortBy : "createdAt"]: query.sortOrder } as Prisma.CrmWorkflowExecutionOrderByWithRelationInput;
  const [rows, totalCount] = await Promise.all([
    prisma.crmWorkflowExecution.findMany({ where, orderBy: [orderBy, { id: "asc" }], skip: query.skip, take: query.take, include: { workflow: { select: { name: true } }, workflowVersion: { select: { versionNumber: true } } } }),
    prisma.crmWorkflowExecution.count({ where }),
  ]);
  const [labels, names] = await Promise.all([recordLabels(rows), userNames(rows.flatMap((r) => [r.runAsUserId, r.startedByUserId]))]);
  return { totalCount, data: rows.map((r) => presentExecution(r, labels, names)) };
}

export async function getExecution(actor: CrmActor, executionId: string) {
  const r = await prisma.crmWorkflowExecution.findFirst({ where: { id: executionId, companyId: actor.companyId }, include: { workflow: { select: { name: true } }, workflowVersion: { select: { versionNumber: true, definition: true } } } });
  if (!r) throw new BusinessRuleError("NOT_FOUND", "Execution not found.", { executionId });
  const steps = await prisma.crmWorkflowExecutionStep.findMany({ where: { executionId }, orderBy: { sequence: "asc" } });
  const [labels, names] = await Promise.all([recordLabels([r]), userNames([r.runAsUserId, r.startedByUserId])]);
  const def = workflowDefinitionSchema.safeParse(r.workflowVersion.definition);
  const nodeNames = new Map((def.success ? def.data.nodes : []).map((n) => [n.id, n.name || (n.type === "ACTION" ? ((WORKFLOW_ACTIONS[n.action as WorkflowActionKey] as WorkflowActionDef | undefined)?.label ?? n.action) : NODE_TYPES[n.type].label)]));
  const ctx = r.context && typeof r.context === "object" && !Array.isArray(r.context) ? (r.context as Record<string, unknown>) : {};
  return {
    ...presentExecution(r, labels, names),
    trigger: ctx.trigger ?? null,
    steps: steps.map((s) => ({
      id: s.id,
      sequence: s.sequence,
      nodeId: s.nodeId,
      nodeName: nodeNames.get(s.nodeId) ?? s.nodeId,
      nodeType: s.nodeType,
      actionKey: s.actionKey,
      actionLabel: s.actionKey ? ((WORKFLOW_ACTIONS[s.actionKey as WorkflowActionKey] as WorkflowActionDef | undefined)?.label ?? s.actionKey) : null,
      status: s.status,
      attempt: s.attempt,
      input: s.input,
      output: s.output,
      branch: s.branch,
      error: s.errorCode || s.errorMessage ? { code: s.errorCode, message: s.errorMessage } : null,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
    })),
  };
}

async function loadExecutionForChange(actor: CrmActor, executionId: string) {
  const r = await prisma.crmWorkflowExecution.findFirst({ where: { id: executionId, companyId: actor.companyId, mode: "LIVE" }, include: { workflow: { select: { id: true, name: true, status: true } } } });
  if (!r) throw new BusinessRuleError("NOT_FOUND", "Execution not found.", { executionId });
  return r;
}

async function guardedExecutionUpdate(executionId: string, from: string[], data: Prisma.CrmWorkflowExecutionUpdateManyMutationInput, message: string) {
  const { count } = await prisma.crmWorkflowExecution.updateMany({ where: { id: executionId, status: { in: from as never[] } }, data });
  if (!count) throw new BusinessRuleError("INVALID_STATE_TRANSITION", message);
}

export async function cancelExecution(actor: CrmActor, executionId: string) {
  const r = await loadExecutionForChange(actor, executionId);
  await guardedExecutionUpdate(executionId, ["QUEUED", "WAITING", "PAUSED"], { status: "CANCELLED", outcome: "CANCELLED", exitReason: "Cancelled by a user.", finishedAt: new Date(), nextRunAt: null }, r.status === "RUNNING" ? "This execution is running a step right now. Try again in a moment." : "Only queued, waiting or paused executions can be cancelled.");
  await runCrmMutation(actor, async (ctx) => {
    await ctx.audit({ tableName: "crm_workflow_executions", recordId: executionId, action: "CANCEL", oldValues: { status: r.status } });
    emit(ctx, r.workflow, "workflow.execution_cancelled", "Execution cancelled", { executionId, entityType: r.entityType, entityId: r.entityId });
  });
  return getExecution(actor, executionId);
}

export async function pauseExecution(actor: CrmActor, executionId: string) {
  const r = await loadExecutionForChange(actor, executionId);
  await guardedExecutionUpdate(executionId, ["QUEUED", "WAITING"], { status: "PAUSED" }, r.status === "RUNNING" ? "This execution is running a step right now. Try again in a moment." : "Only queued or waiting executions can be paused.");
  await runCrmMutation(actor, (ctx) => ctx.audit({ tableName: "crm_workflow_executions", recordId: executionId, action: "UPDATE", oldValues: { status: r.status }, newValues: { status: "PAUSED" } }));
  return getExecution(actor, executionId);
}

/** Resumes a paused execution where it was (a wait that has passed continues immediately). */
export async function resumeExecution(actor: CrmActor, executionId: string) {
  const r = await loadExecutionForChange(actor, executionId);
  if (r.workflow.status !== "PUBLISHED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Resume the workflow first — it isn't active.");
  await guardedExecutionUpdate(executionId, ["PAUSED"], { status: "WAITING" }, "Only paused executions can be resumed.");
  await runCrmMutation(actor, (ctx) => ctx.audit({ tableName: "crm_workflow_executions", recordId: executionId, action: "UPDATE", oldValues: { status: "PAUSED" }, newValues: { status: "WAITING" } }));
  await runExecution(executionId);
  return getExecution(actor, executionId);
}

/**
 * Retries a FAILED execution from the step that failed. Safe for messages:
 * the step's message id is derived from its idempotency key, so a message
 * that actually went out the first time is not sent again.
 */
export async function retryExecution(actor: CrmActor, executionId: string) {
  const r = await loadExecutionForChange(actor, executionId);
  if (r.workflow.status !== "PUBLISHED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The workflow isn't active — resume or publish it first.");
  if (!r.currentNodeId) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Nothing to retry.");
  await guardedExecutionUpdate(executionId, ["FAILED"], { status: "QUEUED", outcome: null, finishedAt: null, nextRunAt: new Date(), retryCount: 1, errorCode: null, errorMessage: null }, "Only failed executions can be retried.");
  await runCrmMutation(actor, (ctx) => ctx.audit({ tableName: "crm_workflow_executions", recordId: executionId, action: "UPDATE", oldValues: { status: "FAILED", errorCode: r.errorCode }, newValues: { status: "QUEUED", retriedBy: actor.userId } }));
  await runExecution(executionId);
  return getExecution(actor, executionId);
}

// ── Editor metadata ─────────────────────────────────────────────

/** Everything the editor needs: triggers, actions, fields, waits, limits and lookup lists. */
export async function getWorkflowMeta(actor: CrmActor) {
  const companyId = actor.companyId;
  const [users, leadStatuses, leadSources, companyStatuses, pipelines, tags, templates, customByEntity] = await Promise.all([
    prisma.user.findMany({ where: { companyId, status: "ACTIVE" }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    prisma.crmLeadStatus.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true, kind: true }, orderBy: { sortOrder: "asc" } }),
    prisma.crmLeadSource.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.crmCompanyStatus.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
    prisma.crmPipeline.findMany({ where: { companyId, archivedAt: null }, select: { id: true, name: true, stages: { where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } }),
    prisma.crmTag.findMany({ where: { companyId }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }),
    prisma.crmMessageTemplate.findMany({ where: { companyId, status: "ACTIVE" }, select: { id: true, name: true, channelType: true }, orderBy: { name: "asc" } }),
    Promise.all((["LEAD", "CONTACT", "COMPANY", "OPPORTUNITY"] as WorkflowEntity[]).map(async (e) => [e, await customFieldDefs(companyId, e)] as const)),
  ]);
  return {
    statuses: Object.entries(WORKFLOW_STATUSES).map(([key, v]) => ({ key, ...v })),
    executionStatuses: Object.entries(EXECUTION_STATUSES).map(([key, v]) => ({ key, ...v })),
    nodeTypes: Object.entries(NODE_TYPES).map(([key, v]) => ({ key, ...v })),
    reentryModes: Object.entries(REENTRY_MODES).map(([key, label]) => ({ key, label })),
    triggers: WORKFLOW_TRIGGER_KEYS.map((key) => ({ key, ...(WORKFLOW_TRIGGERS[key] as WorkflowTriggerDef) })),
    unavailableTriggers: UNAVAILABLE_TRIGGERS,
    actions: Object.entries(WORKFLOW_ACTIONS).map(([key, v]) => ({ key, ...v })),
    unavailableActions: UNAVAILABLE_ACTIONS,
    entities: Object.entries(WORKFLOW_ENTITIES).map(([key, v]) => ({ key, ...v })),
    recordFields: WORKFLOW_RECORD_FIELDS,
    commonFields: WORKFLOW_COMMON_FIELDS,
    customFields: Object.fromEntries(customByEntity),
    limits: WORKFLOW_LIMITS,
    lookups: {
      user: users.map((u) => ({ value: u.id, label: u.fullName })),
      leadStatus: leadStatuses.map((s) => ({ value: s.id, label: s.name, kind: s.kind })),
      leadSource: leadSources.map((s) => ({ value: s.id, label: s.name })),
      companyStatus: companyStatuses.map((s) => ({ value: s.id, label: s.name })),
      pipeline: pipelines.map((p) => ({ value: p.id, label: p.name })),
      stage: pipelines.flatMap((p) => p.stages.map((s) => ({ value: s.id, label: `${p.name} · ${s.name}` }))),
      tag: tags.map((t) => ({ value: t.id, label: t.name })),
      template: templates.map((t) => ({ value: t.id, label: `${t.name} (${t.channelType})`, channelType: t.channelType })),
    },
  };
}
