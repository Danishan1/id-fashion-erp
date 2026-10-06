import type { CrmOpportunity, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { CrmActor } from "../core/crm-actor";
import type { CrmDb } from "../core/crm-db";
import type { CrmMutationContext } from "../core/crm-mutation";
import { listCustomFields } from "../custom-fields/crm-custom-fields.service";
import { isClosedStatus, type OpportunityStatus } from "../opportunities/opportunity-registry";
import { CrmPipelineRepository, type CrmPipelineRow, type CrmStageRow } from "./crm-pipeline.repository";
import { missingRequirements, type MissingRequirement, type RequirementSnapshot } from "./stage-requirements";

/**
 * Phase 07 — the single place an opportunity's stage or pipeline changes.
 *
 *   evaluateTransition()  pure check (also the "validate" API): record state,
 *                         pipeline, stage, transition rules, required fields
 *                         and registered business validators.
 *   transitionUpdate()    the column changes for an allowed move.
 *   recordTransition()    stage-history row + AuditLog + timeline event.
 *
 * Every path — stage action, edit form, bulk, pipeline transfer, stage /
 * pipeline archive reassignment — goes through these, so the backend is the
 * authority no matter which screen or API made the request. Rejected moves
 * write nothing (no history row, no event).
 */

export type TransitionSource = "FORM" | "STAGE_ACTION" | "BULK" | "TRANSFER" | "STAGE_ARCHIVE" | "PIPELINE_ARCHIVE" | "CREATE";
export type TransitionChangeType = "INITIAL" | "STAGE_CHANGE" | "PIPELINE_TRANSFER" | "STAGE_REASSIGNED";
export type ProbabilitySource = "STAGE" | "MANUAL";

export interface TransitionIssue {
  code:
    | "OPPORTUNITY_ARCHIVED"
    | "OPPORTUNITY_CLOSED"
    | "PIPELINE_NOT_FOUND"
    | "PIPELINE_ARCHIVED"
    | "STAGE_NOT_FOUND"
    | "STAGE_ARCHIVED"
    | "STAGE_NOT_IN_PIPELINE"
    | "TRANSITION_NOT_ALLOWED"
    | "REQUIRED_FIELDS_MISSING"
    | "BUSINESS_RULE";
  message: string;
}

export interface TransitionEvaluation {
  allowed: boolean;
  /** Target equals the current stage (nothing to move). */
  noop: boolean;
  changeType: TransitionChangeType;
  from: { pipeline: CrmPipelineRow | null; stage: CrmStageRow | null };
  to: { pipeline: CrmPipelineRow | null; stage: CrmStageRow | null };
  issues: TransitionIssue[];
  missingFields: MissingRequirement[];
  probability: { from: number | null; to: number | null; source: ProbabilitySource | null };
}

export interface TransitionRequest {
  pipelineId?: string | null;
  stageId?: string | null;
  /** Explicit probability from the user (undefined = apply the usual rule). */
  probability?: number | null;
  /** Reset a hand-set probability to the stage default. */
  useStageProbability?: boolean;
  /**
   * Values the move should be checked against when the same request also
   * edits the record (edit form); merged over the stored opportunity.
   */
  overrides?: Partial<RequirementSnapshot>;
  /**
   * Administrative reassignment (stage / pipeline archive): only checks the
   * target exists and is active — rules, required fields and the open-state
   * check are skipped, because the source stage is going away.
   */
  administrative?: boolean;
}

/** Extension point: extra business checks (e.g. "a sales order is required for Closing" once quotations exist). */
export type StageTransitionValidator = (input: {
  opportunity: CrmOpportunity;
  from: TransitionEvaluation["from"];
  to: { pipeline: CrmPipelineRow; stage: CrmStageRow };
  snapshot: RequirementSnapshot;
}) => TransitionIssue[] | Promise<TransitionIssue[]>;
const VALIDATORS: StageTransitionValidator[] = [];
export function registerStageTransitionValidator(v: StageTransitionValidator) {
  VALIDATORS.push(v);
  return () => {
    const i = VALIDATORS.indexOf(v);
    if (i >= 0) VALIDATORS.splice(i, 1);
  };
}

// ── Probability ──────────────────────────────────────────────────

/**
 * What an opportunity's probability becomes when it enters a stage.
 * MANUAL values are kept; STAGE (or never set) follows the new stage's
 * default. An explicit value wins and is MANUAL unless it equals the stage
 * default. Pre-Phase 07 rows without a source follow the stage when their
 * value still equals the old stage's default (the Phase 06 rule).
 */
export function resolveStageProbability(input: {
  current: number | null;
  currentSource: string | null;
  oldStageProbability: number | null | undefined;
  newStageProbability: number | null | undefined;
  explicit?: number | null;
  useStageProbability?: boolean;
}): { value: number | null; source: ProbabilitySource | null } {
  const stageP = input.newStageProbability ?? null;
  if (input.explicit !== undefined) {
    if (input.explicit === null) return { value: null, source: null };
    return { value: input.explicit, source: stageP !== null && input.explicit === stageP ? "STAGE" : "MANUAL" };
  }
  const manual =
    input.current !== null &&
    (input.currentSource === "MANUAL" || (input.currentSource === null && input.current !== (input.oldStageProbability ?? null)));
  if (manual && !input.useStageProbability) return { value: input.current, source: "MANUAL" };
  if (stageP !== null) return { value: stageP, source: "STAGE" };
  return { value: input.current, source: input.current === null ? null : ((input.currentSource as ProbabilitySource | null) ?? "MANUAL") };
}

/** Source for a probability set outside a stage move (edit form / probability-only change). */
export function probabilitySourceFor(value: number | null, stageProbability: number | null | undefined): ProbabilitySource | null {
  if (value === null) return null;
  return stageProbability !== null && stageProbability !== undefined && value === stageProbability ? "STAGE" : "MANUAL";
}

// ── Snapshot ─────────────────────────────────────────────────────

async function erpLinkTypes(opportunityId: string, db: CrmDb) {
  const rows = await db.crmOpportunityErpLink.findMany({ where: { opportunityId }, select: { docType: true }, distinct: ["docType"] });
  return rows.map((r) => r.docType);
}

export async function requirementSnapshot(opp: CrmOpportunity, overrides: Partial<RequirementSnapshot> = {}, db: CrmDb = prisma): Promise<RequirementSnapshot> {
  return {
    crmCompanyId: opp.crmCompanyId,
    crmContactId: opp.crmContactId,
    amount: opp.amount,
    currencyCode: opp.currencyCode,
    expectedCloseDate: opp.expectedCloseDate,
    description: opp.description,
    ownerUserId: opp.ownerUserId,
    sourceId: opp.sourceId,
    probability: opp.probability,
    customFields: (opp.customFields as Record<string, unknown>) ?? {},
    erpLinkTypes: overrides.erpLinkTypes ?? (await erpLinkTypes(opp.id, db)),
    ...overrides,
  };
}

const asKeys = (v: Prisma.JsonValue | undefined | null) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// ── Evaluate ─────────────────────────────────────────────────────

/**
 * Checks a move without changing anything. `target.pipelineId` alone (no
 * stage) means "that pipeline's default stage" (pipeline transfer).
 */
export async function evaluateTransition(companyId: string, opp: CrmOpportunity, request: TransitionRequest, db: CrmDb = prisma): Promise<TransitionEvaluation> {
  const issues: TransitionIssue[] = [];
  const [fromPipeline, fromStage] = await Promise.all([
    opp.pipelineId ? CrmPipelineRepository.findPipeline(companyId, opp.pipelineId, db) : null,
    opp.stageId ? CrmPipelineRepository.findStage(companyId, opp.stageId, db) : null,
  ]);
  const from = { pipeline: fromPipeline, stage: fromStage };

  let stage: CrmStageRow | null = null;
  let pipeline: CrmPipelineRow | null = null;
  if (request.stageId) {
    stage = await CrmPipelineRepository.findStage(companyId, request.stageId, db);
    if (!stage) issues.push({ code: "STAGE_NOT_FOUND", message: "Choose a valid stage." });
    else if (request.pipelineId && request.pipelineId !== stage.pipelineId) issues.push({ code: "STAGE_NOT_IN_PIPELINE", message: "That stage belongs to a different pipeline." });
  }
  const pipelineId = stage?.pipelineId ?? request.pipelineId ?? null;
  if (pipelineId) pipeline = await CrmPipelineRepository.findPipeline(companyId, pipelineId, db);
  if (!pipeline && !issues.length) issues.push({ code: "PIPELINE_NOT_FOUND", message: "Choose a valid pipeline." });
  if (pipeline && !stage && !request.stageId) {
    stage = await CrmPipelineRepository.defaultStage(companyId, pipeline.id, db);
    if (!stage) issues.push({ code: "STAGE_NOT_FOUND", message: `"${pipeline.name}" has no active stage.` });
  }

  const transfer = Boolean(pipeline && opp.pipelineId && pipeline.id !== opp.pipelineId);
  const changeType: TransitionChangeType = request.administrative ? (transfer ? "PIPELINE_TRANSFER" : "STAGE_REASSIGNED") : !opp.stageId ? "INITIAL" : transfer ? "PIPELINE_TRANSFER" : "STAGE_CHANGE";
  const noop = Boolean(stage && stage.id === opp.stageId);
  const probability = resolveStageProbability({
    current: opp.probability,
    currentSource: opp.probabilitySource,
    oldStageProbability: fromStage?.probability,
    newStageProbability: stage?.probability,
    explicit: request.probability,
    useStageProbability: request.useStageProbability,
  });
  // A closed deal keeps its probability when an admin reassigns it.
  if (request.administrative && isClosedStatus(opp.status as OpportunityStatus)) Object.assign(probability, { value: opp.probability, source: opp.probabilitySource });
  const result = (missingFields: MissingRequirement[] = []): TransitionEvaluation => ({
    allowed: issues.length === 0,
    noop,
    changeType,
    from,
    to: { pipeline, stage },
    issues,
    missingFields,
    probability: { from: opp.probability, to: probability.value, source: probability.source },
  });

  if (!request.administrative) {
    if (opp.archivedAt) issues.push({ code: "OPPORTUNITY_ARCHIVED", message: "Restore this opportunity before changing its stage." });
    else if (isClosedStatus(opp.status as OpportunityStatus)) issues.push({ code: "OPPORTUNITY_CLOSED", message: "This opportunity is closed. Reopen it before changing its stage." });
  }
  if (!pipeline || !stage || issues.some((i) => i.code.startsWith("STAGE_") || i.code.startsWith("PIPELINE_"))) return result();
  if (noop) return result();
  if (pipeline.archivedAt) issues.push({ code: "PIPELINE_ARCHIVED", message: `The "${pipeline.name}" pipeline is archived.` });
  if (stage.archivedAt) issues.push({ code: "STAGE_ARCHIVED", message: `"${stage.name}" is archived and can't be chosen.` });
  if (issues.length || request.administrative) return result();

  // Transition rules apply to moves inside one pipeline.
  const required = new Set(asKeys(stage.requiredFields));
  if (!transfer && fromStage) {
    const rule = await CrmPipelineRepository.findRule(fromStage.id, stage.id, db);
    if (rule && !rule.allowed) issues.push({ code: "TRANSITION_NOT_ALLOWED", message: rule.message || `Moving from "${fromStage.name}" to "${stage.name}" is not allowed.` });
    else if (!rule && fromStage.transitionMode === "ONLY_LISTED") issues.push({ code: "TRANSITION_NOT_ALLOWED", message: `From "${fromStage.name}" an opportunity can only move to the stages listed in its rules.` });
    if (rule?.allowed) for (const k of asKeys(rule.requiredFields)) required.add(k);
  }

  const snapshot = await requirementSnapshot(opp, request.overrides, db);
  let missing: MissingRequirement[] = [];
  if (required.size) {
    const custom = await listCustomFields(companyId, "OPPORTUNITY", { includeInactive: true });
    missing = missingRequirements([...required], snapshot, custom);
    if (missing.length) issues.push({ code: "REQUIRED_FIELDS_MISSING", message: `To move to "${stage.name}", fill in: ${missing.map((m) => m.label).join(", ")}.` });
  }
  for (const v of VALIDATORS) issues.push(...(await v({ opportunity: opp, from, to: { pipeline, stage }, snapshot })));
  return result(missing);
}

/** Throws CRM_STAGE_TRANSITION_BLOCKED (422) with the reasons and missing fields (field errors for forms). */
export function assertTransitionAllowed(ev: TransitionEvaluation) {
  if (ev.allowed) return;
  const fieldErrors: Record<string, string> = {};
  const stageName = ev.to.stage?.name ?? "this stage";
  for (const m of ev.missingFields) if (m.field) fieldErrors[m.field] = `Required for "${stageName}"`;
  if (ev.issues.some((i) => i.code === "STAGE_NOT_FOUND" || i.code === "STAGE_ARCHIVED" || i.code === "STAGE_NOT_IN_PIPELINE")) fieldErrors.stageId = ev.issues[0].message;
  if (ev.issues.some((i) => i.code === "PIPELINE_NOT_FOUND" || i.code === "PIPELINE_ARCHIVED")) fieldErrors.pipelineId = ev.issues.find((i) => i.code.startsWith("PIPELINE_"))!.message;
  const onlyState = ev.issues.every((i) => i.code === "OPPORTUNITY_ARCHIVED" || i.code === "OPPORTUNITY_CLOSED");
  if (onlyState) throw new BusinessRuleError("INVALID_STATE_TRANSITION", ev.issues[0].message);
  // A bad target (unknown / archived pipeline or stage) is an input error, not a refused move.
  if (ev.issues.every((i) => i.code.startsWith("STAGE_") || i.code.startsWith("PIPELINE_") || i.code.startsWith("OPPORTUNITY_"))) {
    throw new BusinessRuleError("VALIDATION_ERROR", ev.issues.map((i) => i.message).join(" "), { fieldErrors, reasons: ev.issues });
  }
  throw new BusinessRuleError("CRM_STAGE_TRANSITION_BLOCKED", ev.issues.map((i) => i.message).join(" "), {
    reasons: ev.issues,
    missingFields: ev.missingFields,
    fieldErrors,
    toStageId: ev.to.stage?.id ?? null,
  });
}

/** JSON-safe view of an evaluation for the validate API and the UI. */
export function presentEvaluation(ev: TransitionEvaluation) {
  const ref = (s: { id: string; name: string } | null) => (s ? { id: s.id, name: s.name } : null);
  return {
    allowed: ev.allowed,
    noop: ev.noop,
    changeType: ev.changeType,
    from: { pipeline: ref(ev.from.pipeline), stage: ref(ev.from.stage) },
    to: { pipeline: ref(ev.to.pipeline), stage: ev.to.stage ? { id: ev.to.stage.id, name: ev.to.stage.name, probability: ev.to.stage.probability } : null },
    reasons: ev.issues,
    missingFields: ev.missingFields,
    probability: ev.probability,
  };
}

// ── Apply ────────────────────────────────────────────────────────

/** Column changes for an allowed (non-noop) move. */
export function transitionUpdate(ev: TransitionEvaluation, at = new Date()): Prisma.CrmOpportunityUncheckedUpdateManyInput {
  return { pipelineId: ev.to.pipeline!.id, stageId: ev.to.stage!.id, stageChangedAt: at, probability: ev.probability.to, probabilitySource: ev.probability.source };
}

const EVENT_SUMMARY_SUFFIX: Partial<Record<TransitionChangeType, string>> = { STAGE_REASSIGNED: " (stage archived)" };

/**
 * Writes the history row, AuditLog entry and timeline event for a move that
 * has just been applied (inside the same mutation). `audit: false` when the
 * caller already audits the whole record (edit form).
 */
export async function recordTransition(
  ctx: CrmMutationContext,
  actor: CrmActor,
  before: Pick<CrmOpportunity, "id" | "pipelineId" | "stageId" | "probability" | "probabilitySource">,
  ev: TransitionEvaluation,
  meta: { source: TransitionSource; reason?: string | null; audit?: boolean; bulk?: boolean; at?: Date }
) {
  const to = { pipeline: ev.to.pipeline!, stage: ev.to.stage! };
  const at = meta.at ?? new Date();
  await ctx.tx.crmOpportunityStageHistory.create({
    data: {
      companyId: actor.companyId,
      opportunityId: before.id,
      changeType: ev.changeType,
      source: meta.source,
      fromPipelineId: before.pipelineId,
      toPipelineId: to.pipeline.id,
      fromStageId: before.stageId,
      toStageId: to.stage.id,
      fromStageName: ev.from.stage?.name ?? null,
      toStageName: to.stage.name,
      fromProbability: before.probability,
      toProbability: ev.probability.to,
      probabilitySource: ev.probability.source,
      reason: meta.reason ?? null,
      changedByUserId: actor.userId,
      changedAt: at,
    },
  });
  if (meta.audit !== false) {
    await ctx.audit({
      tableName: "crm_opportunities",
      recordId: before.id,
      action: "UPDATE",
      oldValues: { pipelineId: before.pipelineId, stageId: before.stageId, probability: before.probability, probabilitySource: before.probabilitySource },
      newValues: { pipelineId: to.pipeline.id, stageId: to.stage.id, probability: ev.probability.to, probabilitySource: ev.probability.source, changeType: ev.changeType, source: meta.source, ...(meta.bulk ? { bulk: true } : {}) },
    });
  }
  if (ev.changeType === "INITIAL") return;
  const payload = {
    changeType: ev.changeType,
    source: meta.source,
    fromStageId: before.stageId,
    fromStage: ev.from.stage?.name ?? null,
    toStageId: to.stage.id,
    toStage: to.stage.name,
    fromPipelineId: before.pipelineId,
    fromPipeline: ev.from.pipeline?.name ?? null,
    toPipelineId: to.pipeline.id,
    toPipeline: to.pipeline.name,
    fromProbability: before.probability,
    toProbability: ev.probability.to,
    probabilitySource: ev.probability.source,
    ...(meta.reason ? { reason: meta.reason } : {}),
    ...(meta.bulk ? { bulk: true } : {}),
  };
  if (ev.changeType === "PIPELINE_TRANSFER") {
    ctx.emit({
      entityType: "OPPORTUNITY",
      entityId: before.id,
      eventType: "opportunity.pipeline_transferred",
      summary: `${ev.from.pipeline?.name ?? "—"} → ${to.pipeline.name} · ${to.stage.name}${meta.source === "PIPELINE_ARCHIVE" ? " (pipeline archived)" : ""}`,
      payload,
    });
    return;
  }
  ctx.emit({
    entityType: "OPPORTUNITY",
    entityId: before.id,
    eventType: "opportunity.stage_changed",
    summary: `${ev.from.stage ? `${ev.from.stage.name} → ` : "Stage: "}${to.stage.name}${EVENT_SUMMARY_SUFFIX[ev.changeType] ?? ""}`,
    payload,
  });
}

/** Records where a new opportunity started (no timeline event — "created" already says it). */
export async function recordInitialStage(
  ctx: CrmMutationContext,
  actor: CrmActor,
  opp: { id: string; pipelineId: string | null; stageId: string | null; probability: number | null; probabilitySource: string | null },
  stage: { id: string; name: string },
  source: TransitionSource = "CREATE"
) {
  if (!opp.pipelineId || !opp.stageId) return;
  await ctx.tx.crmOpportunityStageHistory.create({
    data: {
      companyId: actor.companyId,
      opportunityId: opp.id,
      changeType: "INITIAL",
      source,
      toPipelineId: opp.pipelineId,
      toStageId: stage.id,
      toStageName: stage.name,
      toProbability: opp.probability,
      probabilitySource: opp.probabilitySource,
      changedByUserId: actor.userId,
    },
  });
}

// ── History ──────────────────────────────────────────────────────

export async function listStageHistory(companyId: string, opportunityId: string) {
  const rows = await prisma.crmOpportunityStageHistory.findMany({ where: { companyId, opportunityId }, orderBy: [{ changedAt: "desc" }, { id: "desc" }], take: 200 });
  const pipelineIds = [...new Set(rows.flatMap((r) => [r.fromPipelineId, r.toPipelineId]).filter((v): v is string => Boolean(v)))];
  const userIds = [...new Set(rows.map((r) => r.changedByUserId).filter((v): v is string => Boolean(v)))];
  const [pipelines, users] = await Promise.all([
    prisma.crmPipeline.findMany({ where: { companyId, id: { in: pipelineIds } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }),
  ]);
  const pName = new Map(pipelines.map((p) => [p.id, p.name]));
  const uName = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({
    id: r.id,
    changeType: r.changeType,
    source: r.source,
    fromPipeline: r.fromPipelineId ? { id: r.fromPipelineId, name: pName.get(r.fromPipelineId) ?? null } : null,
    toPipeline: { id: r.toPipelineId, name: pName.get(r.toPipelineId) ?? null },
    fromStage: r.fromStageId ? { id: r.fromStageId, name: r.fromStageName } : null,
    toStage: { id: r.toStageId, name: r.toStageName },
    fromProbability: r.fromProbability,
    toProbability: r.toProbability,
    probabilitySource: r.probabilitySource,
    result: r.result,
    reason: r.reason,
    changedBy: r.changedByUserId ? { id: r.changedByUserId, name: uName.get(r.changedByUserId) ?? null } : null,
    changedAt: r.changedAt,
  }));
}

/**
 * Required fields of the stage a new opportunity starts in (create form /
 * API). Throws CRM_STAGE_TRANSITION_BLOCKED like a stage move would.
 */
export async function assertCanStartInStage(companyId: string, stage: CrmStageRow, snapshot: Omit<RequirementSnapshot, "erpLinkTypes">) {
  const keys = asKeys(stage.requiredFields);
  if (!keys.length) return;
  const custom = await listCustomFields(companyId, "OPPORTUNITY", { includeInactive: true });
  const missing = missingRequirements(keys, { ...snapshot, erpLinkTypes: [] }, custom);
  if (!missing.length) return;
  const fieldErrors = Object.fromEntries(missing.filter((m) => m.field).map((m) => [m.field!, `Required for "${stage.name}"`]));
  throw new BusinessRuleError("CRM_STAGE_TRANSITION_BLOCKED", `To start in "${stage.name}", fill in: ${missing.map((m) => m.label).join(", ")}.`, {
    reasons: [{ code: "REQUIRED_FIELDS_MISSING", message: `To start in "${stage.name}", fill in: ${missing.map((m) => m.label).join(", ")}.` }],
    missingFields: missing,
    fieldErrors,
    toStageId: stage.id,
  });
}
