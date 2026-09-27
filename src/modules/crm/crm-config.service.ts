import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { CrmPipeline, CrmStageKind } from "@prisma/client";
import { DEFAULT_ENTRY_STAGE_CODE, DEFAULT_LEAD_SOURCES, DEFAULT_LEAD_STAGES, DEFAULT_LOST_REASONS } from "./crm-defaults";
import type { CrmMasterInput, PipelineStageInput } from "./crm-config.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

// Company-scoped CRM configuration masters: pipeline stages, lead sources,
// lost reasons. Plain Prisma calls (no repository file), matching the simple
// lookup masters convention — there is no query complexity worth isolating.

/**
 * Lazily seeds the default stages/sources/lost reasons for a company that has
 * none yet (every company existing at migration time was already seeded by
 * the migration itself; this covers companies provisioned afterwards). Only
 * seeds a list that is completely empty, so an admin who deliberately
 * deactivates every default never has them silently re-created.
 */
export async function ensureCrmDefaults(companyId: string): Promise<void> {
  const [stageCount, sourceCount, reasonCount] = await Promise.all([
    prisma.crmPipelineStage.count({ where: { companyId, pipeline: "LEAD" } }),
    prisma.crmLeadSource.count({ where: { companyId } }),
    prisma.crmLostReason.count({ where: { companyId } }),
  ]);
  await Promise.all([
    stageCount === 0
      ? prisma.crmPipelineStage.createMany({
          data: DEFAULT_LEAD_STAGES.map((s) => ({ companyId, pipeline: "LEAD" as const, ...s })),
          skipDuplicates: true,
        })
      : null,
    sourceCount === 0
      ? prisma.crmLeadSource.createMany({ data: DEFAULT_LEAD_SOURCES.map((s) => ({ companyId, ...s })), skipDuplicates: true })
      : null,
    reasonCount === 0
      ? prisma.crmLostReason.createMany({ data: DEFAULT_LOST_REASONS.map((s) => ({ companyId, ...s })), skipDuplicates: true })
      : null,
  ]);
}

// ── Pipeline stages ──────────────────────────────────────────

export async function listPipelineStages(companyId: string, pipeline: CrmPipeline = "LEAD", opts: { activeOnly?: boolean } = {}) {
  await ensureCrmDefaults(companyId);
  return prisma.crmPipelineStage.findMany({
    where: { companyId, pipeline, ...(opts.activeOnly ? { isActive: true } : {}) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

/** The stage a brand-new lead lands in: the NEW_LEAD code if still active,
 * otherwise the lowest-sorted active OPEN stage. */
export async function getEntryStage(companyId: string) {
  const stages = await listPipelineStages(companyId, "LEAD", { activeOnly: true });
  const stage = stages.find((s) => s.code === DEFAULT_ENTRY_STAGE_CODE && s.kind === "OPEN") ?? stages.find((s) => s.kind === "OPEN");
  if (!stage) {
    throw new BusinessRuleError("VALIDATION_ERROR", "No active open pipeline stage is configured. Add one in CRM Settings → Pipeline Stages.");
  }
  return stage;
}

export async function getStageForCompany(companyId: string, stageId: string) {
  const stage = await prisma.crmPipelineStage.findFirst({ where: { id: stageId, companyId } });
  if (!stage) throw new BusinessRuleError("NOT_FOUND", "Pipeline stage not found.", { stageId });
  return stage;
}

/** Every business action (new lead, Mark Won, Mark Lost) needs at least one
 * active stage of each of these kinds to exist. */
const REQUIRED_KINDS: CrmStageKind[] = ["OPEN", "WON", "LOST"];

async function assertKindsStillCovered(companyId: string, pipeline: CrmPipeline, changedId: string, next: { kind: CrmStageKind; isActive: boolean }) {
  const others = await prisma.crmPipelineStage.findMany({
    where: { companyId, pipeline, isActive: true, id: { not: changedId } },
    select: { kind: true },
  });
  const activeKinds = new Set(others.map((s) => s.kind));
  if (next.isActive) activeKinds.add(next.kind);
  const missing = REQUIRED_KINDS.filter((k) => !activeKinds.has(k));
  if (missing.length > 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `At least one active ${missing.join(" / ")} stage must remain — this change would leave none.`
    );
  }
}

export async function createPipelineStage(actor: ActorContext, input: PipelineStageInput, pipeline: CrmPipeline = "LEAD") {
  await ensureCrmDefaults(actor.companyId);
  const dup = await prisma.crmPipelineStage.findFirst({ where: { companyId: actor.companyId, pipeline, code: input.code } });
  if (dup) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Stage code "${input.code}" is already in use.`);

  const stage = await prisma.crmPipelineStage.create({
    data: {
      companyId: actor.companyId,
      pipeline,
      code: input.code,
      name: input.name,
      kind: input.kind,
      sortOrder: input.sortOrder,
      isActive: input.isActive ?? true,
    },
  });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "crm_pipeline_stages",
    recordId: stage.id,
    action: "CREATE",
    newValues: stage,
  });
  return stage;
}

export async function updatePipelineStage(actor: ActorContext, id: string, input: PipelineStageInput) {
  const existing = await getStageForCompany(actor.companyId, id);
  const isActive = input.isActive ?? existing.isActive;

  if (input.code !== existing.code) {
    const dup = await prisma.crmPipelineStage.findFirst({
      where: { companyId: actor.companyId, pipeline: existing.pipeline, code: input.code, id: { not: id } },
    });
    if (dup) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Stage code "${input.code}" is already in use.`);
  }

  const kindChanged = input.kind !== existing.kind;
  const deactivating = existing.isActive && !isActive;
  if (kindChanged || deactivating) {
    // A stage's kind drives Won/Lost rules and reporting — silently flipping
    // (or hiding) a stage that already holds leads would re-classify them
    // with no lost reason / no conversion. Move the leads out first.
    const leadCount = await prisma.lead.count({ where: { companyId: actor.companyId, stageId: id } });
    if (leadCount > 0) {
      throw new BusinessRuleError(
        "REFERENCED_RECORD_IN_USE",
        `${leadCount} lead(s) are currently in "${existing.name}". Move them to another stage before ${kindChanged ? "changing its type" : "deactivating it"}.`
      );
    }
    await assertKindsStillCovered(actor.companyId, existing.pipeline, id, { kind: input.kind, isActive });
  }

  const updated = await prisma.crmPipelineStage.update({
    where: { id },
    data: { code: input.code, name: input.name, kind: input.kind, sortOrder: input.sortOrder, isActive },
  });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "crm_pipeline_stages",
    recordId: id,
    action: "UPDATE",
    oldValues: existing,
    newValues: updated,
  });
  return updated;
}

// ── Lead sources & lost reasons (identical {code,name,sortOrder,isActive}) ──

type MasterDelegate = typeof prisma.crmLeadSource | typeof prisma.crmLostReason;

function makeCrmMasterOps(getDelegate: () => MasterDelegate, label: string, tableName: string) {
  // Both delegates share an identical shape; the cast keeps one implementation
  // instead of two copy-pasted ones (Prisma's per-model delegate types are
  // nominally distinct even when structurally identical).
  const d = () => getDelegate() as unknown as typeof prisma.crmLeadSource;
  return {
    list: async (companyId: string, opts: { activeOnly?: boolean } = {}) => {
      await ensureCrmDefaults(companyId);
      return d().findMany({
        where: { companyId, ...(opts.activeOnly ? { isActive: true } : {}) },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      });
    },
    create: async (actor: ActorContext, input: CrmMasterInput) => {
      await ensureCrmDefaults(actor.companyId);
      const dup = await d().findFirst({ where: { companyId: actor.companyId, code: input.code } });
      if (dup) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `${label} code "${input.code}" is already in use.`);
      const record = await d().create({
        data: { companyId: actor.companyId, code: input.code, name: input.name, sortOrder: input.sortOrder, isActive: input.isActive ?? true },
      });
      await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName, recordId: record.id, action: "CREATE", newValues: record });
      return record;
    },
    update: async (actor: ActorContext, id: string, input: CrmMasterInput) => {
      const existing = await d().findFirst({ where: { id, companyId: actor.companyId } });
      if (!existing) throw new BusinessRuleError("NOT_FOUND", `${label} not found.`, { id });
      if (input.code !== existing.code) {
        const dup = await d().findFirst({ where: { companyId: actor.companyId, code: input.code, id: { not: id } } });
        if (dup) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `${label} code "${input.code}" is already in use.`);
      }
      const updated = await d().update({
        where: { id },
        data: { code: input.code, name: input.name, sortOrder: input.sortOrder, isActive: input.isActive ?? existing.isActive },
      });
      await writeAuditLog({
        companyId: actor.companyId,
        userId: actor.userId,
        tableName,
        recordId: id,
        action: "UPDATE",
        oldValues: existing,
        newValues: updated,
      });
      return updated;
    },
  };
}

const leadSourceOps = makeCrmMasterOps(() => prisma.crmLeadSource, "Lead source", "crm_lead_sources");
export const listLeadSources = leadSourceOps.list;
export const createLeadSource = leadSourceOps.create;
export const updateLeadSource = leadSourceOps.update;

const lostReasonOps = makeCrmMasterOps(() => prisma.crmLostReason, "Lost reason", "crm_lost_reasons");
export const listLostReasons = lostReasonOps.list;
export const createLostReason = lostReasonOps.create;
export const updateLostReason = lostReasonOps.update;
