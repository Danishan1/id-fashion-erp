import type { CrmOpportunity, Prisma } from "@prisma/client";
import { BusinessRuleError, isUniqueConstraintViolationOnColumn } from "@/core/errors/BusinessRuleError";
import type { CrmActor } from "../core/crm-actor";
import { runCrmMutation, type CrmMutationContext } from "../core/crm-mutation";
import { nameKey } from "../core/crm-normalize";
import { listCustomFields } from "../custom-fields/crm-custom-fields.service";
import { DEFAULT_PIPELINE } from "../opportunities/opportunity-registry";
import { keyFromName } from "../settings/crm-settings.schema";
import { CrmPipelineRepository, type CrmPipelineRow, type CrmStageRow } from "./crm-pipeline.repository";
import { evaluateTransition, recordTransition, transitionUpdate, type TransitionSource } from "./crm-stage-transition.service";
import {
  archivePipelineSchema,
  archiveStageSchema,
  createPipelineSchema,
  createStageSchema,
  reorderStagesSchema,
  updatePipelineSchema,
  updateRequiredFieldsSchema,
  updateStageSchema,
  updateTransitionRulesSchema,
  versionOnlySchema,
} from "./pipeline.schema";
import { isKnownRequirement, requirementLabel, requirementOptions, UNAVAILABLE_REQUIREMENTS } from "./stage-requirements";

/**
 * CRM pipelines and stages — per-company configuration (Phase 06 minimum,
 * Phase 07 management). Configuration changes are written to the ERP
 * AuditLog. Opportunities are never left without a valid pipeline/stage:
 * archiving a stage or pipeline that is still used requires a destination,
 * and every moved opportunity gets a stage-history row and a timeline event.
 * Changing a stage's probability or order never changes opportunities.
 */

const P_TABLE = "crm_pipelines";
const S_TABLE = "crm_pipeline_stages";
const R_TABLE = "crm_stage_transition_rules";

const notFound = (what: "Pipeline" | "Stage", id: string) => new BusinessRuleError("NOT_FOUND", `${what} not found.`, { id });
const conflict = (what: "pipeline" | "stage", id: string) =>
  new BusinessRuleError("RECORD_VERSION_CONFLICT", `This ${what} was changed by someone else after you opened it. Reload to see the latest version, then try again.`, { id });
const textOrNull = (v: string | null | undefined) => (v === undefined || v === null || v.trim() === "" ? null : v.trim());
const asKeys = (v: Prisma.JsonValue) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const statusOf = (r: { archivedAt: Date | null }) => (r.archivedAt ? "ARCHIVED" : "ACTIVE");

// ── Defaults (Phase 06) ──────────────────────────────────────────

export async function ensureDefaultPipeline(companyId: string) {
  if ((await CrmPipelineRepository.count(companyId)) > 0) return;
  try {
    await CrmPipelineRepository.createWithStages(
      companyId,
      { key: DEFAULT_PIPELINE.key, name: DEFAULT_PIPELINE.name, isDefault: true, sortOrder: 10 },
      DEFAULT_PIPELINE.stages.map((s) => ({ ...s }))
    );
  } catch (e) {
    // Two first uses at the same time: the other request created it (unique company+key).
    if ((e as { code?: string }).code !== "P2002") throw e;
  }
}

/** Pipelines with their stages (archived ones included; pickers filter on isActive / archivedAt). */
export async function listPipelines(companyId: string, opts: { includeArchived?: boolean } = {}) {
  await ensureDefaultPipeline(companyId);
  const rows = await CrmPipelineRepository.list(companyId, opts);
  return rows.map((p) => ({ ...p, status: statusOf(p), stages: p.stages.map((s) => ({ ...s, status: statusOf(s), requiredFields: asKeys(s.requiredFields) })) }));
}
export type PipelineWithStages = Awaited<ReturnType<typeof listPipelines>>[number];

/** Default pipeline + its default stage (new opportunities start there). */
export async function getDefaultPipelineStage(companyId: string) {
  await ensureDefaultPipeline(companyId);
  const pipeline = await CrmPipelineRepository.findDefault(companyId);
  if (!pipeline) return null;
  const stage = await CrmPipelineRepository.defaultStage(companyId, pipeline.id);
  return stage ? { pipeline, stage } : null;
}

/**
 * Validates a pipeline/stage pair chosen when creating an opportunity: both
 * in the company, the stage belongs to the pipeline and neither is archived
 * (the current stage may be kept even if archived).
 */
export async function resolvePipelineStage(companyId: string, input: { pipelineId?: string | null; stageId: string }, currentStageId?: string | null) {
  const stage = await CrmPipelineRepository.findStage(companyId, input.stageId);
  if (!stage) throw new BusinessRuleError("VALIDATION_ERROR", "Choose a valid stage.", { fieldErrors: { stageId: "Choose a valid stage." } });
  if (input.pipelineId && input.pipelineId !== stage.pipelineId) throw new BusinessRuleError("VALIDATION_ERROR", "That stage belongs to a different pipeline.", { fieldErrors: { stageId: "Choose a stage of the selected pipeline." } });
  const pipeline = await CrmPipelineRepository.findPipeline(companyId, stage.pipelineId);
  if (!pipeline) throw new BusinessRuleError("VALIDATION_ERROR", "Choose a valid pipeline.", { fieldErrors: { pipelineId: "Choose a valid pipeline." } });
  if (stage.id !== currentStageId && (stage.archivedAt || pipeline.archivedAt)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `"${stage.name}" is no longer in use.`, { fieldErrors: { stageId: "Choose an active stage." } });
  }
  return { pipeline, stage };
}

export function getStage(companyId: string, stageId: string) {
  return CrmPipelineRepository.findStage(companyId, stageId);
}

// ── Reads for configuration ──────────────────────────────────────

async function loadPipeline(companyId: string, id: string) {
  const p = await CrmPipelineRepository.findPipeline(companyId, id);
  if (!p) throw notFound("Pipeline", id);
  return p;
}
async function loadStage(companyId: string, pipelineId: string, stageId: string) {
  const s = await CrmPipelineRepository.findStage(companyId, stageId);
  if (!s || s.pipelineId !== pipelineId) throw notFound("Stage", stageId);
  return s;
}

/** Pipelines with stage-level usage counts (for the settings screen; counts only, never the records). */
export async function listPipelinesForSettings(companyId: string) {
  const [pipelines, usage] = await Promise.all([listPipelines(companyId), CrmPipelineRepository.usageByPipeline(companyId)]);
  const by = new Map(usage.map((u) => [u.pipelineId, u]));
  return pipelines.map((p) => ({ ...p, opportunityCount: by.get(p.id)?.total ?? 0, openOpportunityCount: by.get(p.id)?.open ?? 0 }));
}

export async function getPipeline(companyId: string, id: string) {
  await ensureDefaultPipeline(companyId);
  const p = await CrmPipelineRepository.findPipelineWithStages(companyId, id);
  if (!p) throw notFound("Pipeline", id);
  const [usage, rules, custom] = await Promise.all([
    CrmPipelineRepository.usageByStage(companyId, id),
    CrmPipelineRepository.rulesOfPipeline(companyId, id),
    listCustomFields(companyId, "OPPORTUNITY", { includeInactive: true }),
  ]);
  const byStage = new Map(usage.map((u) => [u.stageId, u]));
  return {
    ...p,
    status: statusOf(p),
    opportunityCount: usage.reduce((n, u) => n + u.total, 0),
    openOpportunityCount: usage.reduce((n, u) => n + u.open, 0),
    stages: p.stages.map((s) => ({
      ...s,
      status: statusOf(s),
      requiredFields: asKeys(s.requiredFields),
      requiredFieldLabels: asKeys(s.requiredFields).map((k) => requirementLabel(k, custom)),
      opportunityCount: byStage.get(s.id)?.total ?? 0,
      openOpportunityCount: byStage.get(s.id)?.open ?? 0,
      transitionRules: rules.filter((r) => r.fromStageId === s.id).map((r) => ({ ...r, requiredFields: asKeys(r.requiredFields) })),
    })),
    requirementOptions: requirementOptions(custom),
    unavailableRequirements: UNAVAILABLE_REQUIREMENTS,
  };
}
export type PipelineDetail = Awaited<ReturnType<typeof getPipeline>>;

export async function getStageConfig(companyId: string, pipelineId: string, stageId: string) {
  const pipeline = await getPipeline(companyId, pipelineId);
  const stage = pipeline.stages.find((s) => s.id === stageId);
  if (!stage) throw notFound("Stage", stageId);
  return {
    stage,
    otherStages: pipeline.stages.filter((s) => s.id !== stageId).map((s) => ({ id: s.id, name: s.name, status: s.status })),
    requirementOptions: pipeline.requirementOptions,
    unavailableRequirements: pipeline.unavailableRequirements,
  };
}

/** How many opportunities use a pipeline / stage — shown before archiving. */
export async function pipelineUsage(companyId: string, pipelineId: string) {
  await loadPipeline(companyId, pipelineId);
  const usage = await CrmPipelineRepository.usageByStage(companyId, pipelineId);
  return { total: usage.reduce((n, u) => n + u.total, 0), open: usage.reduce((n, u) => n + u.open, 0), byStage: usage };
}
export async function stageUsage(companyId: string, pipelineId: string, stageId: string) {
  await loadStage(companyId, pipelineId, stageId);
  const u = (await CrmPipelineRepository.usageByStage(companyId, pipelineId)).find((x) => x.stageId === stageId);
  return { total: u?.total ?? 0, open: u?.open ?? 0 };
}

// ── Validation helpers ───────────────────────────────────────────

async function assertUniquePipelineName(companyId: string, name: string, excludeId?: string) {
  const dup = await CrmPipelineRepository.findPipelineByName(companyId, nameKey(name), excludeId);
  if (dup) throw new BusinessRuleError("VALIDATION_ERROR", `A pipeline named "${dup.name}" already exists.`, { fieldErrors: { name: "Use a different name." } });
}
async function assertUniqueStageName(pipelineId: string, name: string, excludeId?: string) {
  const dup = await CrmPipelineRepository.findStageByName(pipelineId, nameKey(name), excludeId);
  if (dup) throw new BusinessRuleError("VALIDATION_ERROR", `This pipeline already has a stage named "${dup.name}".`, { fieldErrors: { name: "Use a different name." } });
}
async function validRequirementKeys(companyId: string, keys: string[] | undefined, field = "requiredFields") {
  if (keys === undefined) return undefined;
  const custom = await listCustomFields(companyId, "OPPORTUNITY", { includeInactive: true });
  const unknown = keys.filter((k) => !isKnownRequirement(k, custom.map((c) => c.key)));
  if (unknown.length) throw new BusinessRuleError("VALIDATION_ERROR", `Unknown required field: ${unknown.join(", ")}.`, { fieldErrors: { [field]: "Choose fields from the list." } });
  return [...new Set(keys)];
}
async function uniquePipelineKey(companyId: string, name: string) {
  const base = keyFromName(name) || "pipeline";
  let key = base;
  for (let i = 2; await CrmPipelineRepository.keyExists(companyId, key); i++) key = `${base}_${i}`.slice(0, 40);
  return key;
}
async function uniqueStageKey(pipelineId: string, name: string, taken: Set<string> = new Set()) {
  const base = keyFromName(name) || "stage";
  let key = base;
  for (let i = 2; taken.has(key) || (await CrmPipelineRepository.stageKeyExists(pipelineId, key)); i++) key = `${base}_${i}`.slice(0, 40);
  taken.add(key);
  return key;
}

async function bumpPipeline(ctx: CrmMutationContext, id: string, version: number, data: Prisma.CrmPipelineUncheckedUpdateManyInput, actor: CrmActor) {
  const { count } = await ctx.tx.crmPipeline.updateMany({ where: { id, version }, data: { ...data, updatedByUserId: actor.userId, version: { increment: 1 } } });
  if (count === 0) throw conflict("pipeline", id);
  return (await CrmPipelineRepository.findPipeline(actor.companyId, id, ctx.tx))!;
}
async function bumpStage(ctx: CrmMutationContext, id: string, version: number, data: Prisma.CrmPipelineStageUncheckedUpdateManyInput, actor: CrmActor) {
  const { count } = await ctx.tx.crmPipelineStage.updateMany({ where: { id, version }, data: { ...data, updatedByUserId: actor.userId, version: { increment: 1 } } });
  if (count === 0) throw conflict("stage", id);
  return (await CrmPipelineRepository.findStage(actor.companyId, id, ctx.tx))!;
}

/** Unique-index races (two admins saving the same name / default at once) become friendly errors. */
function mapConstraint(e: unknown): never {
  if (isUniqueConstraintViolationOnColumn(e, "name_key")) throw new BusinessRuleError("VALIDATION_ERROR", "That name is already used.", { fieldErrors: { name: "Use a different name." } });
  if ((e as { code?: string }).code === "P2002") throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone else changed this configuration at the same time. Reload and try again.");
  throw e;
}

// ── Pipelines ────────────────────────────────────────────────────

export async function createPipeline(actor: CrmActor, raw: unknown) {
  const input = createPipelineSchema.parse(raw);
  await ensureDefaultPipeline(actor.companyId);
  await assertUniquePipelineName(actor.companyId, input.name);
  const stages = input.stages ?? DEFAULT_PIPELINE.stages.map((s) => ({ name: s.name, probability: s.probability, description: null, isDefault: false }));
  const keys = new Set<string>();
  const stageNames = new Set<string>();
  for (const s of stages) {
    if (stageNames.has(nameKey(s.name))) throw new BusinessRuleError("VALIDATION_ERROR", `Stage "${s.name}" is listed twice.`, { fieldErrors: { stages: "Stage names must be unique." } });
    stageNames.add(nameKey(s.name));
  }
  const key = await uniquePipelineKey(actor.companyId, input.name);
  const sortOrder = (await CrmPipelineRepository.maxPipelineSortOrder(actor.companyId)) + 10;
  const defaultIndex = Math.max(0, stages.findIndex((s) => s.isDefault));
  try {
    return await runCrmMutation(actor, async (ctx) => {
      if (input.isDefault) await ctx.tx.crmPipeline.updateMany({ where: { companyId: actor.companyId, isDefault: true }, data: { isDefault: false, version: { increment: 1 } } });
      const p = await ctx.tx.crmPipeline.create({
        data: { companyId: actor.companyId, key, name: input.name, nameKey: nameKey(input.name), description: textOrNull(input.description), isDefault: Boolean(input.isDefault), sortOrder, createdByUserId: actor.userId },
      });
      for (const [i, s] of stages.entries()) {
        await ctx.tx.crmPipelineStage.create({
          data: {
            companyId: actor.companyId,
            pipelineId: p.id,
            key: await uniqueStageKey(p.id, s.name, keys),
            name: s.name,
            nameKey: nameKey(s.name),
            description: textOrNull(s.description),
            probability: s.probability ?? null,
            isDefault: i === defaultIndex,
            sortOrder: (i + 1) * 10,
          },
        });
      }
      await ctx.audit({ tableName: P_TABLE, recordId: p.id, action: "CREATE", newValues: { ...p, stages: stages.map((s) => s.name) } });
      return p;
    });
  } catch (e) {
    mapConstraint(e);
  }
}

export async function updatePipeline(actor: CrmActor, id: string, raw: unknown) {
  const input = updatePipelineSchema.parse(raw);
  const before = await loadPipeline(actor.companyId, id);
  if (input.version !== before.version) throw conflict("pipeline", id);
  const data: Prisma.CrmPipelineUncheckedUpdateManyInput = {};
  if (input.name !== undefined && input.name !== before.name) {
    if (!before.archivedAt) await assertUniquePipelineName(actor.companyId, input.name, id);
    data.name = input.name;
    data.nameKey = nameKey(input.name);
  }
  if (input.description !== undefined) data.description = textOrNull(input.description);
  if (!Object.keys(data).length) return before;
  try {
    return await runCrmMutation(actor, async (ctx) => {
      const after = await bumpPipeline(ctx, id, input.version, data, actor);
      await ctx.audit({ tableName: P_TABLE, recordId: id, action: "UPDATE", oldValues: { name: before.name, description: before.description }, newValues: { name: after.name, description: after.description } });
      return after;
    });
  } catch (e) {
    mapConstraint(e);
  }
}

/** Exactly one default: the old default is cleared in the same transaction; both changes are audited. */
export async function setDefaultPipeline(actor: CrmActor, id: string, raw: unknown) {
  const { version } = versionOnlySchema.parse(raw);
  const target = await loadPipeline(actor.companyId, id);
  if (target.archivedAt) throw new BusinessRuleError("VALIDATION_ERROR", "Restore this pipeline before making it the default.");
  if (target.isDefault) return target;
  if (!(await CrmPipelineRepository.defaultStage(actor.companyId, id))) throw new BusinessRuleError("VALIDATION_ERROR", "Add an active stage to this pipeline first.");
  try {
    return await runCrmMutation(actor, async (ctx) => {
      const previous = await ctx.tx.crmPipeline.findFirst({ where: { companyId: actor.companyId, isDefault: true }, select: { id: true, name: true } });
      if (previous) {
        await ctx.tx.crmPipeline.updateMany({ where: { id: previous.id }, data: { isDefault: false, updatedByUserId: actor.userId, version: { increment: 1 } } });
        await ctx.audit({ tableName: P_TABLE, recordId: previous.id, action: "UPDATE", oldValues: { isDefault: true }, newValues: { isDefault: false, replacedBy: id } });
      }
      const after = await bumpPipeline(ctx, id, version, { isDefault: true }, actor);
      await ctx.audit({ tableName: P_TABLE, recordId: id, action: "UPDATE", oldValues: { isDefault: false }, newValues: { isDefault: true, previousDefaultId: previous?.id ?? null } });
      return after;
    });
  } catch (e) {
    mapConstraint(e);
  }
}

/**
 * Archives a pipeline. The default pipeline can't be archived until another
 * one is the default. If it still has opportunities (open, closed or
 * archived), a destination pipeline is required: each opportunity moves to
 * the mapped stage (stageMap), else targetStageId, else the destination's
 * default stage — recorded as a pipeline transfer on its timeline.
 */
export async function archivePipeline(actor: CrmActor, id: string, raw: unknown) {
  const input = archivePipelineSchema.parse(raw);
  const before = await loadPipeline(actor.companyId, id);
  if (before.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This pipeline is already archived.");
  if (input.version !== before.version) throw conflict("pipeline", id);
  if (before.isDefault) throw new BusinessRuleError("VALIDATION_ERROR", "This is the default pipeline. Make another pipeline the default before archiving it.");
  const usage = await pipelineUsage(actor.companyId, id);

  let destination: { pipeline: CrmPipelineRow; fallback: CrmStageRow; stages: Map<string, CrmStageRow> } | null = null;
  if (usage.total > 0) {
    if (!input.targetPipelineId) {
      throw new BusinessRuleError("VALIDATION_ERROR", `${usage.total} opportunit${usage.total === 1 ? "y uses" : "ies use"} this pipeline. Choose where to move ${usage.total === 1 ? "it" : "them"}.`, {
        fieldErrors: { targetPipelineId: "Choose a pipeline to move the opportunities to." },
        usage,
      });
    }
    if (!input.confirm) throw new BusinessRuleError("VALIDATION_ERROR", `Confirm moving ${usage.total} opportunit${usage.total === 1 ? "y" : "ies"}.`, { fieldErrors: { confirm: "Confirm the move." }, usage });
    if (input.targetPipelineId === id) throw new BusinessRuleError("VALIDATION_ERROR", "Choose a different pipeline.", { fieldErrors: { targetPipelineId: "Choose a different pipeline." } });
    const target = await CrmPipelineRepository.findPipeline(actor.companyId, input.targetPipelineId);
    if (!target || target.archivedAt) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active pipeline.", { fieldErrors: { targetPipelineId: "Choose an active pipeline." } });
    const stages = new Map((await CrmPipelineRepository.stagesOf(actor.companyId, target.id)).filter((s) => !s.archivedAt).map((s) => [s.id, s]));
    const fallback = input.targetStageId ? stages.get(input.targetStageId) : await CrmPipelineRepository.defaultStage(actor.companyId, target.id);
    if (!fallback) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active stage of the destination pipeline.", { fieldErrors: { targetStageId: "Choose an active stage of that pipeline." } });
    for (const to of Object.values(input.stageMap ?? {})) {
      if (!stages.has(to)) throw new BusinessRuleError("VALIDATION_ERROR", "Every mapped stage must be an active stage of the destination pipeline.", { fieldErrors: { stageMap: "Choose active stages of that pipeline." } });
    }
    destination = { pipeline: target, fallback, stages };
  }

  return runCrmMutation(actor, async (ctx) => {
    let moved = 0;
    if (destination) {
      const opps = await CrmPipelineRepository.opportunitiesInPipeline(actor.companyId, id, ctx.tx);
      for (const o of opps) {
        const toStageId = (o.stageId && input.stageMap?.[o.stageId]) || destination.fallback.id;
        await reassignOpportunity(ctx, actor, o, { pipelineId: destination.pipeline.id, stageId: toStageId }, "PIPELINE_ARCHIVE", `Pipeline "${before.name}" archived`);
        moved++;
      }
    }
    const after = await bumpPipeline(ctx, id, input.version, { archivedAt: new Date(), archivedByUserId: actor.userId, isActive: false }, actor);
    await ctx.audit({ tableName: P_TABLE, recordId: id, action: "UPDATE", oldValues: { archivedAt: null }, newValues: { archivedAt: after.archivedAt, movedOpportunities: moved, targetPipelineId: destination?.pipeline.id ?? null } });
    return { pipeline: after, movedOpportunities: moved };
  });
}

export async function restorePipeline(actor: CrmActor, id: string, raw: unknown) {
  const { version } = versionOnlySchema.parse(raw);
  const before = await loadPipeline(actor.companyId, id);
  if (!before.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This pipeline is not archived.");
  await assertUniquePipelineName(actor.companyId, before.name, id);
  try {
    return await runCrmMutation(actor, async (ctx) => {
      const after = await bumpPipeline(ctx, id, version, { archivedAt: null, archivedByUserId: null, isActive: true }, actor);
      await ctx.audit({ tableName: P_TABLE, recordId: id, action: "UPDATE", oldValues: { archivedAt: before.archivedAt }, newValues: { archivedAt: null } });
      return after;
    });
  } catch (e) {
    mapConstraint(e);
  }
}

// ── Stages ───────────────────────────────────────────────────────

export async function listStages(companyId: string, pipelineId: string) {
  return (await getPipeline(companyId, pipelineId)).stages;
}

export async function getStageDetail(companyId: string, pipelineId: string, stageId: string) {
  return (await getStageConfig(companyId, pipelineId, stageId)).stage;
}

/** New stages are added at the end; `isDefault` replaces the current default stage (audited). */
export async function createStage(actor: CrmActor, pipelineId: string, raw: unknown) {
  const input = createStageSchema.parse(raw);
  const pipeline = await loadPipeline(actor.companyId, pipelineId);
  if (pipeline.archivedAt) throw new BusinessRuleError("VALIDATION_ERROR", "Restore this pipeline before adding stages.");
  await assertUniqueStageName(pipelineId, input.name);
  const requiredFields = (await validRequirementKeys(actor.companyId, input.requiredFields)) ?? [];
  const key = await uniqueStageKey(pipelineId, input.name);
  try {
    return await runCrmMutation(actor, async (ctx) => {
      const sortOrder = (await CrmPipelineRepository.maxStageSortOrder(pipelineId, ctx.tx)) + 10;
      const hasDefault = Boolean(await ctx.tx.crmPipelineStage.findFirst({ where: { pipelineId, isDefault: true }, select: { id: true } }));
      if (input.isDefault && hasDefault) await clearDefaultStage(ctx, actor, pipelineId);
      const s = await ctx.tx.crmPipelineStage.create({
        data: {
          companyId: actor.companyId,
          pipelineId,
          key,
          name: input.name,
          nameKey: nameKey(input.name),
          description: textOrNull(input.description),
          probability: input.probability ?? null,
          isDefault: Boolean(input.isDefault) || !hasDefault,
          requiredFields,
          transitionMode: input.transitionMode ?? "ANY",
          sortOrder,
        },
      });
      await ctx.audit({ tableName: S_TABLE, recordId: s.id, action: "CREATE", newValues: s });
      return s;
    });
  } catch (e) {
    mapConstraint(e);
  }
}

async function clearDefaultStage(ctx: CrmMutationContext, actor: CrmActor, pipelineId: string, replacedBy?: string) {
  const previous = await ctx.tx.crmPipelineStage.findFirst({ where: { pipelineId, isDefault: true }, select: { id: true } });
  if (!previous) return null;
  await ctx.tx.crmPipelineStage.updateMany({ where: { id: previous.id }, data: { isDefault: false, updatedByUserId: actor.userId, version: { increment: 1 } } });
  await ctx.audit({ tableName: S_TABLE, recordId: previous.id, action: "UPDATE", oldValues: { isDefault: true }, newValues: { isDefault: false, replacedBy: replacedBy ?? null } });
  return previous.id;
}

/** Name, description, probability (new value applies to future stage entries only), required fields, transition mode. */
export async function updateStage(actor: CrmActor, pipelineId: string, stageId: string, raw: unknown) {
  const input = updateStageSchema.parse(raw);
  const before = await loadStage(actor.companyId, pipelineId, stageId);
  if (input.version !== before.version) throw conflict("stage", stageId);
  const data: Prisma.CrmPipelineStageUncheckedUpdateManyInput = {};
  if (input.name !== undefined && input.name !== before.name) {
    if (!before.archivedAt) await assertUniqueStageName(pipelineId, input.name, stageId);
    data.name = input.name;
    data.nameKey = nameKey(input.name);
  }
  if (input.description !== undefined) data.description = textOrNull(input.description);
  if (input.probability !== undefined && input.probability !== before.probability) data.probability = input.probability;
  const required = await validRequirementKeys(actor.companyId, input.requiredFields);
  if (required !== undefined && JSON.stringify(required) !== JSON.stringify(asKeys(before.requiredFields))) data.requiredFields = required;
  if (input.transitionMode !== undefined && input.transitionMode !== before.transitionMode) data.transitionMode = input.transitionMode;
  if (!Object.keys(data).length) return before;
  try {
    return await runCrmMutation(actor, async (ctx) => {
      const after = await bumpStage(ctx, stageId, input.version, data, actor);
      const old = Object.fromEntries(Object.keys(data).filter((k) => k !== "nameKey").map((k) => [k, before[k as keyof CrmStageRow]]));
      await ctx.audit({ tableName: S_TABLE, recordId: stageId, action: "UPDATE", oldValues: old, newValues: Object.fromEntries(Object.keys(old).map((k) => [k, after[k as keyof CrmStageRow]])) });
      return after;
    });
  } catch (e) {
    mapConstraint(e);
  }
}

export async function updateStageRequiredFields(actor: CrmActor, pipelineId: string, stageId: string, raw: unknown) {
  const input = updateRequiredFieldsSchema.parse(raw);
  await loadStage(actor.companyId, pipelineId, stageId);
  return updateStage(actor, pipelineId, stageId, { version: input.version, requiredFields: input.requiredFields });
}

/**
 * Changes the display order only — opportunities keep their stage. Archived
 * stages stay after the active ones in their existing order.
 */
export async function reorderStages(actor: CrmActor, pipelineId: string, raw: unknown) {
  const { ids } = reorderStagesSchema.parse(raw);
  await loadPipeline(actor.companyId, pipelineId);
  const stages = await CrmPipelineRepository.stagesOf(actor.companyId, pipelineId);
  const active = stages.filter((s) => !s.archivedAt);
  const known = new Set(active.map((s) => s.id));
  if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((x) => !known.has(x))) {
    throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "The stages changed since you loaded them. Reload and try again.");
  }
  const archived = stages.filter((s) => s.archivedAt).map((s) => s.id);
  const order = [...ids, ...archived];
  await runCrmMutation(actor, async (ctx) => {
    for (const [i, sid] of order.entries()) {
      const s = stages.find((x) => x.id === sid)!;
      if (s.sortOrder !== (i + 1) * 10) await ctx.tx.crmPipelineStage.update({ where: { id: sid }, data: { sortOrder: (i + 1) * 10, updatedByUserId: actor.userId, version: { increment: 1 } } });
    }
    await ctx.audit({ tableName: S_TABLE, recordId: pipelineId, action: "UPDATE", oldValues: { order: active.map((s) => s.name) }, newValues: { pipelineId, order: ids.map((x) => active.find((s) => s.id === x)!.name) } });
  });
  return listStages(actor.companyId, pipelineId);
}

export async function setDefaultStage(actor: CrmActor, pipelineId: string, stageId: string, raw: unknown) {
  const { version } = versionOnlySchema.parse(raw);
  const stage = await loadStage(actor.companyId, pipelineId, stageId);
  if (stage.archivedAt) throw new BusinessRuleError("VALIDATION_ERROR", "Restore this stage before making it the default.");
  if (stage.isDefault) return stage;
  try {
    return await runCrmMutation(actor, async (ctx) => {
      const previous = await clearDefaultStage(ctx, actor, pipelineId, stageId);
      const after = await bumpStage(ctx, stageId, version, { isDefault: true }, actor);
      await ctx.audit({ tableName: S_TABLE, recordId: stageId, action: "UPDATE", oldValues: { isDefault: false }, newValues: { isDefault: true, previousDefaultId: previous } });
      return after;
    });
  } catch (e) {
    mapConstraint(e);
  }
}

/**
 * Archives a stage. The default stage and the last active stage can't be
 * archived. Opportunities in the stage (open, closed or archived) must be
 * moved to another active stage of the same pipeline — confirmed by the
 * caller — and each move is recorded (history + timeline). The stage id on
 * an opportunity is never cleared.
 */
export async function archiveStage(actor: CrmActor, pipelineId: string, stageId: string, raw: unknown) {
  const input = archiveStageSchema.parse(raw);
  const before = await loadStage(actor.companyId, pipelineId, stageId);
  if (before.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This stage is already archived.");
  if (input.version !== before.version) throw conflict("stage", stageId);
  if (before.isDefault) throw new BusinessRuleError("VALIDATION_ERROR", "This is the pipeline's default stage. Make another stage the default before archiving it.");
  const active = (await CrmPipelineRepository.stagesOf(actor.companyId, pipelineId)).filter((s) => !s.archivedAt);
  if (active.length <= 1) throw new BusinessRuleError("VALIDATION_ERROR", "A pipeline needs at least one active stage.");
  const usage = await stageUsage(actor.companyId, pipelineId, stageId);
  let target: CrmStageRow | null = null;
  if (usage.total > 0) {
    if (!input.reassignToStageId) {
      throw new BusinessRuleError("VALIDATION_ERROR", `${usage.total} opportunit${usage.total === 1 ? "y is" : "ies are"} in this stage. Choose a stage to move ${usage.total === 1 ? "it" : "them"} to.`, {
        fieldErrors: { reassignToStageId: "Choose a stage to move the opportunities to." },
        usage,
      });
    }
    if (!input.confirm) throw new BusinessRuleError("VALIDATION_ERROR", `Confirm moving ${usage.total} opportunit${usage.total === 1 ? "y" : "ies"}.`, { fieldErrors: { confirm: "Confirm the move." }, usage });
    target = active.find((s) => s.id === input.reassignToStageId && s.id !== stageId) ?? null;
    if (!target) throw new BusinessRuleError("VALIDATION_ERROR", "Choose another active stage of this pipeline.", { fieldErrors: { reassignToStageId: "Choose another active stage of this pipeline." } });
  }
  return runCrmMutation(actor, async (ctx) => {
    let moved = 0;
    if (target) {
      for (const o of await CrmPipelineRepository.opportunitiesInStage(actor.companyId, stageId, ctx.tx)) {
        await reassignOpportunity(ctx, actor, o, { pipelineId, stageId: target.id }, "STAGE_ARCHIVE", `Stage "${before.name}" archived`);
        moved++;
      }
    }
    const after = await bumpStage(ctx, stageId, input.version, { archivedAt: new Date(), archivedByUserId: actor.userId, isActive: false }, actor);
    await ctx.audit({ tableName: S_TABLE, recordId: stageId, action: "UPDATE", oldValues: { archivedAt: null }, newValues: { archivedAt: after.archivedAt, movedOpportunities: moved, reassignedToStageId: target?.id ?? null } });
    return { stage: after, movedOpportunities: moved };
  });
}

export async function restoreStage(actor: CrmActor, pipelineId: string, stageId: string, raw: unknown) {
  const { version } = versionOnlySchema.parse(raw);
  const pipeline = await loadPipeline(actor.companyId, pipelineId);
  const before = await loadStage(actor.companyId, pipelineId, stageId);
  if (!before.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This stage is not archived.");
  if (pipeline.archivedAt) throw new BusinessRuleError("VALIDATION_ERROR", "Restore the pipeline first.");
  await assertUniqueStageName(pipelineId, before.name, stageId);
  try {
    return await runCrmMutation(actor, async (ctx) => {
      // Restored stages go to the end of the active list.
      const lastActive = await ctx.tx.crmPipelineStage.aggregate({ where: { pipelineId, archivedAt: null }, _max: { sortOrder: true } });
      const after = await bumpStage(ctx, stageId, version, { archivedAt: null, archivedByUserId: null, isActive: true, sortOrder: (lastActive._max.sortOrder ?? 0) + 5 }, actor);
      await ctx.audit({ tableName: S_TABLE, recordId: stageId, action: "UPDATE", oldValues: { archivedAt: before.archivedAt }, newValues: { archivedAt: null } });
      return after;
    });
  } catch (e) {
    mapConstraint(e);
  }
}

// ── Transition rules ─────────────────────────────────────────────

export async function getTransitionRules(companyId: string, pipelineId: string, stageId: string) {
  const stage = await loadStage(companyId, pipelineId, stageId);
  const rules = await CrmPipelineRepository.rulesFrom(companyId, stageId);
  return { stageId, version: stage.version, transitionMode: stage.transitionMode, rules: rules.map((r) => ({ ...r, requiredFields: asKeys(r.requiredFields) })) };
}

/** Replaces every rule leaving the stage (and its transition mode) in one audited change. */
export async function updateTransitionRules(actor: CrmActor, pipelineId: string, stageId: string, raw: unknown) {
  const input = updateTransitionRulesSchema.parse(raw);
  const stage = await loadStage(actor.companyId, pipelineId, stageId);
  if (input.version !== stage.version) throw conflict("stage", stageId);
  const stages = new Map((await CrmPipelineRepository.stagesOf(actor.companyId, pipelineId)).map((s) => [s.id, s]));
  const seen = new Set<string>();
  for (const r of input.rules) {
    if (r.toStageId === stageId) throw new BusinessRuleError("VALIDATION_ERROR", "A stage can't have a rule to itself.", { fieldErrors: { rules: "Remove the rule to the same stage." } });
    if (!stages.has(r.toStageId)) throw new BusinessRuleError("VALIDATION_ERROR", "Rules can only point to stages of the same pipeline.", { fieldErrors: { rules: "Choose stages of this pipeline." } });
    if (seen.has(r.toStageId)) throw new BusinessRuleError("VALIDATION_ERROR", `There are two rules for "${stages.get(r.toStageId)!.name}".`, { fieldErrors: { rules: "One rule per destination stage." } });
    seen.add(r.toStageId);
    r.requiredFields = await validRequirementKeys(actor.companyId, r.requiredFields ?? [], "rules");
  }
  const before = await CrmPipelineRepository.rulesFrom(actor.companyId, stageId);
  return runCrmMutation(actor, async (ctx) => {
    await bumpStage(ctx, stageId, input.version, { transitionMode: input.transitionMode }, actor);
    await ctx.tx.crmStageTransitionRule.deleteMany({ where: { companyId: actor.companyId, fromStageId: stageId } });
    if (input.rules.length) {
      await ctx.tx.crmStageTransitionRule.createMany({
        data: input.rules.map((r) => ({
          companyId: actor.companyId,
          pipelineId,
          fromStageId: stageId,
          toStageId: r.toStageId,
          allowed: r.allowed,
          requiredFields: r.requiredFields ?? [],
          message: textOrNull(r.message ?? null),
          createdByUserId: actor.userId,
        })),
      });
    }
    await ctx.audit({
      tableName: R_TABLE,
      recordId: stageId,
      action: "UPDATE",
      oldValues: { transitionMode: stage.transitionMode, rules: before.map((r) => ({ toStageId: r.toStageId, allowed: r.allowed, requiredFields: r.requiredFields })) },
      newValues: { transitionMode: input.transitionMode, rules: input.rules },
    });
    return getTransitionRulesTx(ctx, actor.companyId, stageId);
  });
}

async function getTransitionRulesTx(ctx: CrmMutationContext, companyId: string, stageId: string) {
  const stage = (await CrmPipelineRepository.findStage(companyId, stageId, ctx.tx))!;
  const rules = await CrmPipelineRepository.rulesFrom(companyId, stageId, ctx.tx);
  return { stageId, version: stage.version, transitionMode: stage.transitionMode, rules: rules.map((r) => ({ ...r, requiredFields: asKeys(r.requiredFields) })) };
}

// ── Administrative reassignment (stage / pipeline archive) ───────

async function reassignOpportunity(ctx: CrmMutationContext, actor: CrmActor, o: CrmOpportunity, target: { pipelineId: string; stageId: string }, source: TransitionSource, reason: string) {
  const ev = await evaluateTransition(actor.companyId, o, { ...target, administrative: true }, ctx.tx);
  if (!ev.allowed) throw new BusinessRuleError("VALIDATION_ERROR", ev.issues.map((i) => i.message).join(" "));
  if (ev.noop) return;
  await ctx.tx.crmOpportunity.update({ where: { id: o.id }, data: { ...(transitionUpdate(ev) as Prisma.CrmOpportunityUncheckedUpdateInput), updatedByUserId: actor.userId, version: { increment: 1 } } });
  await recordTransition(ctx, actor, o, ev, { source, reason });
}
