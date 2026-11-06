import { Prisma, type MarketingAttributionModel, type MarketingAttributionModelVersion } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { modelCreateSchema, modelRulesSchema, type ModelRules } from "./attribution-registry";

/**
 * Attribution models (Phase 13). Header + numbered versions holding the
 * rules. A version is edited only as a draft and approved by someone other
 * than who prepared or submitted it; approving makes it the model's rules
 * (and the model ACTIVE). An approved version never changes (DB trigger) and
 * the runs made with it keep pointing at it, so old results stay explainable.
 * History: sales_performance_events (entity ATTRIBUTION_MODEL) + audit_logs.
 */

const TABLE = "marketing_attribution_models";
const VERSION_TABLE = "marketing_attribution_model_versions";
type Tx = Prisma.TransactionClient;

const commentSchema = z.object({ comment: z.string().trim().max(1000).optional().or(z.literal("")).nullable() }).strict();
const reasonSchema = z.object({ reason: z.string().trim().min(3, "Say why").max(1000) }).strict();
export const modelHeaderSchema = z.object({ name: z.string().trim().min(1).max(150), description: z.string().trim().max(2000).optional().nullable(), version: z.coerce.number().int() }).strict();

function event(tx: Tx, actor: SalesActor, modelId: string, type: string, comment: string | null = null, metadata: Record<string, unknown> = {}) {
  return tx.salesPerformanceEvent.create({ data: { companyId: actor.companyId, entityType: "ATTRIBUTION_MODEL", entityId: modelId, type, comment, metadata: metadata as Prisma.InputJsonValue, createdByUserId: actor.userId } });
}

async function audit(tx: Tx, actor: SalesActor, tableName: string, recordId: string, action: "CREATE" | "UPDATE" | "APPROVE" | "REJECT", oldValues: unknown, newValues: unknown) {
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName, recordId, action, oldValues: oldValues as Record<string, unknown>, newValues: newValues as Record<string, unknown> }, tx);
}

async function loadModel(actor: SalesActor, id: string) {
  const m = await prisma.marketingAttributionModel.findFirst({ where: { id, companyId: actor.companyId } });
  if (!m) throw new BusinessRuleError("NOT_FOUND", "Attribution model not found.", { id });
  return m;
}

async function loadVersion(actor: SalesActor, m: MarketingAttributionModel, versionId: string) {
  const v = await prisma.marketingAttributionModelVersion.findFirst({ where: { id: versionId, modelId: m.id, companyId: actor.companyId } });
  if (!v) throw new BusinessRuleError("NOT_FOUND", "Model version not found.", { versionId });
  return v;
}

const notRetired = (m: MarketingAttributionModel) => {
  if (m.status === "RETIRED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This model is retired — nothing about it can change.");
};

async function canApprove(userId: string, v: Pick<MarketingAttributionModelVersion, "createdByUserId" | "updatedByUserId" | "submittedByUserId">) {
  const people = [...new Set([v.createdByUserId, v.updatedByUserId, v.submittedByUserId].filter((x): x is string => Boolean(x)))];
  for (const createdBy of people) if (!(await PermissionService.can(userId, "marketing_attribution", "approve", { createdBy }))) return false;
  return PermissionService.can(userId, "marketing_attribution", "approve");
}

const rulesData = (r: ModelRules) => ({
  modelType: r.modelType,
  windowDays: r.windowDays,
  touchpointTypes: r.touchpointTypes,
  channelTypes: r.channelTypes,
  conversionTypes: r.conversionTypes,
  collapseRepeats: r.collapseRepeats,
  firstTouchPercent: r.modelType === "POSITION_BASED" && r.firstTouchPercent !== null ? new Prisma.Decimal(r.firstTouchPercent) : null,
  lastTouchPercent: r.modelType === "POSITION_BASED" && r.lastTouchPercent !== null ? new Prisma.Decimal(r.lastTouchPercent) : null,
  halfLifeDays: r.modelType === "TIME_DECAY" && r.halfLifeDays !== null ? new Prisma.Decimal(r.halfLifeDays) : null,
  changeNote: r.changeNote || null,
});

/** A stored version as rules (also what the calculation uses). */
export function rulesOf(v: MarketingAttributionModelVersion) {
  return {
    modelType: v.modelType as ModelRules["modelType"],
    windowDays: v.windowDays,
    touchpointTypes: v.touchpointTypes as ModelRules["touchpointTypes"],
    channelTypes: v.channelTypes as ModelRules["channelTypes"],
    conversionTypes: v.conversionTypes as ModelRules["conversionTypes"],
    collapseRepeats: v.collapseRepeats,
    firstTouchPercent: v.firstTouchPercent === null ? null : Number(v.firstTouchPercent),
    lastTouchPercent: v.lastTouchPercent === null ? null : Number(v.lastTouchPercent),
    halfLifeDays: v.halfLifeDays === null ? null : Number(v.halfLifeDays),
    changeNote: v.changeNote,
  };
}

// ── Read ───────────────────────────────────────────────────────────

export async function listModels(actor: SalesActor, opts: { includeRetired?: boolean } = {}) {
  await PermissionService.assert(actor.userId, "marketing_attribution", "view");
  const rows = await prisma.marketingAttributionModel.findMany({
    where: { companyId: actor.companyId, ...(opts.includeRetired ? {} : { status: { not: "RETIRED" } }) },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    include: {
      approvedVersion: true,
      versions: { where: { status: { in: ["DRAFT", "PENDING_APPROVAL"] } }, select: { versionNumber: true, status: true } },
      runs: { where: { status: "COMPLETED" }, orderBy: { finishedAt: "desc" }, take: 1, select: { id: true, finishedAt: true, periodFrom: true, periodTo: true } },
    },
  });
  return rows.map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    status: m.status,
    isDefault: m.isDefault,
    approved: m.approvedVersion ? { id: m.approvedVersion.id, number: m.approvedVersion.versionNumber, ...rulesOf(m.approvedVersion) } : null,
    openVersion: m.versions[0] ? { number: m.versions[0].versionNumber, status: m.versions[0].status } : null,
    lastRun: m.runs[0] ? { id: m.runs[0].id, finishedAt: m.runs[0].finishedAt?.toISOString() ?? null, from: m.runs[0].periodFrom.toISOString().slice(0, 10), to: m.runs[0].periodTo.toISOString().slice(0, 10) } : null,
  }));
}

export async function getModel(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "marketing_attribution", "view");
  const m = await prisma.marketingAttributionModel.findFirst({
    where: { id, companyId: actor.companyId },
    include: { versions: { orderBy: { versionNumber: "desc" } } },
  });
  if (!m) throw new BusinessRuleError("NOT_FOUND", "Attribution model not found.", { id });
  const userIds = [...new Set([m.ownerUserId, ...m.versions.flatMap((v) => [v.createdByUserId, v.submittedByUserId, v.decidedByUserId])].filter((x): x is string => Boolean(x)))];
  const [users, events, runs, perms] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }),
    prisma.salesPerformanceEvent.findMany({ where: { companyId: actor.companyId, entityType: "ATTRIBUTION_MODEL", entityId: m.id }, orderBy: { createdAt: "desc" }, take: 200, include: { createdBy: { select: { fullName: true } } } }),
    prisma.marketingAttributionRun.findMany({ where: { modelId: m.id }, orderBy: { queuedAt: "desc" }, take: 30, include: { modelVersion: { select: { versionNumber: true } } } }),
    Promise.all((["create", "edit", "approve", "reject"] as const).map((a) => PermissionService.can(actor.userId, "marketing_attribution", a))),
  ]);
  const name = new Map(users.map((u) => [u.id, u.fullName]));
  const [canCreate, canEdit, canApproveAny, canReject] = perms;
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    description: m.description,
    status: m.status,
    isDefault: m.isDefault,
    version: m.version,
    owner: name.get(m.ownerUserId) ?? "—",
    approvedVersionId: m.approvedVersionId,
    versions: await Promise.all(
      m.versions.map(async (v) => ({
        id: v.id,
        number: v.versionNumber,
        status: v.status,
        rules: rulesOf(v),
        createdBy: name.get(v.createdByUserId) ?? "—",
        createdAt: v.createdAt.toISOString(),
        submittedBy: v.submittedByUserId ? (name.get(v.submittedByUserId) ?? "—") : null,
        decidedBy: v.decidedByUserId ? (name.get(v.decidedByUserId) ?? "—") : null,
        decidedAt: v.decidedAt?.toISOString() ?? null,
        decisionComment: v.decisionComment,
        canApproveThis: v.status === "PENDING_APPROVAL" && m.status !== "RETIRED" && (await canApprove(actor.userId, v)),
      }))
    ),
    runs: runs.map((r) => ({
      id: r.id,
      versionNumber: r.modelVersion.versionNumber,
      status: r.status,
      trigger: r.trigger,
      from: r.periodFrom.toISOString().slice(0, 10),
      to: r.periodTo.toISOString().slice(0, 10),
      conversions: r.conversions,
      attributed: r.attributed,
      unattributed: r.unattributed,
      excluded: r.excluded,
      queuedAt: r.queuedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      error: r.error,
    })),
    events: events.map((e) => ({ id: e.id, type: e.type, comment: e.comment, metadata: e.metadata, at: e.createdAt.toISOString(), by: e.createdBy.fullName })),
    can: {
      edit: canEdit && m.status !== "RETIRED",
      newVersion: (canCreate || canEdit) && m.status !== "RETIRED" && !m.versions.some((v) => v.status === "DRAFT" || v.status === "PENDING_APPROVAL"),
      approve: canApproveAny,
      reject: canReject,
      recalculate: canEdit && m.status === "ACTIVE",
      setDefault: canApproveAny && m.status === "ACTIVE" && !m.isDefault,
      retire: canEdit && m.status !== "RETIRED",
    },
  };
}

// ── Write ──────────────────────────────────────────────────────────

export async function createModel(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_attribution", "create");
  const input = modelCreateSchema.parse(raw);
  try {
    return await prisma.$transaction(async (tx) => {
      const m = await tx.marketingAttributionModel.create({ data: { companyId: actor.companyId, code: input.code, name: input.name, description: input.description || null, ownerUserId: actor.userId, createdByUserId: actor.userId } });
      const v = await tx.marketingAttributionModelVersion.create({ data: { companyId: actor.companyId, modelId: m.id, versionNumber: 1, status: "DRAFT", ...rulesData(input.rules), createdByUserId: actor.userId } });
      await event(tx, actor, m.id, "CREATED", null, { version: 1 });
      await audit(tx, actor, TABLE, m.id, "CREATE", null, { code: m.code, name: m.name });
      await audit(tx, actor, VERSION_TABLE, v.id, "CREATE", null, input.rules);
      return { id: m.id };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new BusinessRuleError("VALIDATION_ERROR", "A model with this code already exists.", { fieldErrors: { code: "Already used." } });
    throw e;
  }
}

export async function updateModelHeader(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_attribution", "edit");
  const input = modelHeaderSchema.parse(raw);
  const m = await loadModel(actor, id);
  notRetired(m);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.marketingAttributionModel.updateMany({ where: { id: m.id, companyId: actor.companyId, version: input.version, status: { not: "RETIRED" } }, data: { name: input.name, description: input.description || null, updatedByUserId: actor.userId, version: { increment: 1 } } });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This model changed after you opened it. Reload and try again.");
    await event(tx, actor, m.id, "HEADER_UPDATED");
    await audit(tx, actor, TABLE, m.id, "UPDATE", { name: m.name, description: m.description }, input);
  });
  return { id };
}

export async function saveVersionRules(actor: SalesActor, id: string, versionId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_attribution", "edit");
  const rules = modelRulesSchema.parse(raw);
  const m = await loadModel(actor, id);
  notRetired(m);
  const v = await loadVersion(actor, m, versionId);
  if (v.status !== "DRAFT") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a draft version can be edited. Start a new version to change approved rules.");
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.marketingAttributionModelVersion.updateMany({ where: { id: v.id, status: "DRAFT", updatedAt: v.updatedAt }, data: { ...rulesData(rules), updatedByUserId: actor.userId } });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This version changed just now. Reload and try again.");
    await event(tx, actor, m.id, "VERSION_SAVED", null, { version: v.versionNumber });
    await audit(tx, actor, VERSION_TABLE, v.id, "UPDATE", rulesOf(v), rules);
  });
  return { id };
}

export async function newVersion(actor: SalesActor, id: string) {
  if (!(await PermissionService.can(actor.userId, "marketing_attribution", "edit"))) await PermissionService.assert(actor.userId, "marketing_attribution", "create");
  const m = await loadModel(actor, id);
  notRetired(m);
  const latest = await prisma.marketingAttributionModelVersion.findFirstOrThrow({ where: { modelId: m.id }, orderBy: { versionNumber: "desc" } });
  try {
    await prisma.$transaction(async (tx) => {
      const next = m.currentVersionNumber + 1;
      const { count } = await tx.marketingAttributionModel.updateMany({ where: { id: m.id, currentVersionNumber: m.currentVersionNumber }, data: { currentVersionNumber: next, updatedByUserId: actor.userId, version: { increment: 1 } } });
      if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This model changed just now. Reload and try again.");
      await tx.marketingAttributionModelVersion.create({ data: { companyId: actor.companyId, modelId: m.id, versionNumber: next, status: "DRAFT", ...rulesData({ ...rulesOf(latest), changeNote: null }), createdByUserId: actor.userId } });
      await event(tx, actor, m.id, "VERSION_CREATED", null, { version: next, from: latest.versionNumber });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A version is already being prepared or approved. Finish that one first.");
    throw e;
  }
  return { id };
}

async function moveVersion(tx: Tx, v: MarketingAttributionModelVersion, data: Prisma.MarketingAttributionModelVersionUncheckedUpdateManyInput) {
  const { count } = await tx.marketingAttributionModelVersion.updateMany({ where: { id: v.id, status: v.status, updatedAt: v.updatedAt }, data });
  if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This version changed just now. Reload and try again.");
}

export async function submitVersion(actor: SalesActor, id: string, versionId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_attribution", "edit");
  const { comment } = commentSchema.parse(raw ?? {});
  const m = await loadModel(actor, id);
  notRetired(m);
  const v = await loadVersion(actor, m, versionId);
  if (v.status !== "DRAFT") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a draft version can be submitted.");
  modelRulesSchema.parse(rulesOf(v)); // stored rules still valid
  await prisma.$transaction(async (tx) => {
    await moveVersion(tx, v, { status: "PENDING_APPROVAL", submittedByUserId: actor.userId, submittedAt: new Date() });
    await event(tx, actor, m.id, "SUBMITTED", comment || null, { version: v.versionNumber });
    await audit(tx, actor, VERSION_TABLE, v.id, "UPDATE", { status: "DRAFT" }, { status: "PENDING_APPROVAL" });
    const users = await prisma.user.findMany({ where: { companyId: actor.companyId, status: "ACTIVE", supportForPlatformUserId: null }, select: { id: true } });
    const ok = await Promise.all(users.map((u) => PermissionService.can(u.id, "marketing_attribution", "approve")));
    for (const u of users.filter((x, i) => ok[i] && x.id !== actor.userId && x.id !== v.createdByUserId)) {
      await createNotification({ companyId: actor.companyId, userId: u.id, title: `Attribution model ${m.code} v${v.versionNumber} needs approval`, body: comment || m.name }, tx);
    }
  });
  return { id };
}

export async function returnVersionToDraft(actor: SalesActor, id: string, versionId: string, raw: unknown) {
  const { comment } = commentSchema.parse(raw ?? {});
  const m = await loadModel(actor, id);
  const v = await loadVersion(actor, m, versionId);
  if (v.status !== "PENDING_APPROVAL") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a version waiting for approval can go back to draft.");
  await PermissionService.assert(actor.userId, "marketing_attribution", v.submittedByUserId === actor.userId ? "edit" : "approve");
  await prisma.$transaction(async (tx) => {
    await moveVersion(tx, v, { status: "DRAFT", submittedByUserId: null, submittedAt: null });
    await event(tx, actor, m.id, "RETURNED_TO_DRAFT", comment || null, { version: v.versionNumber });
    await audit(tx, actor, VERSION_TABLE, v.id, "UPDATE", { status: "PENDING_APPROVAL" }, { status: "DRAFT" });
  });
  return { id };
}

/** Approving makes the version the model's rules and the model ACTIVE. Earlier runs keep their own version. */
export async function approveVersion(actor: SalesActor, id: string, versionId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_attribution", "approve");
  const { comment } = commentSchema.parse(raw ?? {});
  const m0 = await loadModel(actor, id);
  notRetired(m0);
  const v = await loadVersion(actor, m0, versionId);
  if (v.status !== "PENDING_APPROVAL") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a version waiting for approval can be approved.");
  if (!(await canApprove(actor.userId, v))) throw new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "Someone other than the person who prepared or submitted this version must approve it.");
  modelRulesSchema.parse(rulesOf(v));
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM marketing_attribution_models WHERE id = ${m0.id}::uuid FOR UPDATE`;
    const m = await tx.marketingAttributionModel.findUniqueOrThrow({ where: { id: m0.id } });
    if (m.status === "RETIRED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This model was retired just now.");
    await moveVersion(tx, v, { status: "APPROVED", decidedByUserId: actor.userId, decidedAt: new Date(), decisionComment: comment || null });
    if (m.approvedVersionId) await tx.marketingAttributionModelVersion.update({ where: { id: m.approvedVersionId }, data: { status: "SUPERSEDED" } });
    await tx.marketingAttributionModel.update({ where: { id: m.id }, data: { approvedVersionId: v.id, status: "ACTIVE", updatedByUserId: actor.userId, version: { increment: 1 } } });
    await event(tx, actor, m.id, "APPROVED", comment || null, { version: v.versionNumber, supersedes: m.approvedVersionId });
    await audit(tx, actor, VERSION_TABLE, v.id, "APPROVE", { status: "PENDING_APPROVAL" }, { status: "APPROVED", supersedes: m.approvedVersionId });
    for (const userId of new Set([v.submittedByUserId, v.createdByUserId].filter((x): x is string => Boolean(x) && x !== actor.userId))) {
      await createNotification({ companyId: actor.companyId, userId, title: `Attribution model ${m.code} v${v.versionNumber} approved`, body: "Recalculate to see results under the new rules." }, tx);
    }
  });
  return { id };
}

export async function rejectVersion(actor: SalesActor, id: string, versionId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_attribution", "reject");
  const { reason } = reasonSchema.parse(raw ?? {});
  const m = await loadModel(actor, id);
  const v = await loadVersion(actor, m, versionId);
  if (v.status !== "PENDING_APPROVAL") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a version waiting for approval can be rejected.");
  if ([v.createdByUserId, v.submittedByUserId].includes(actor.userId)) throw new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "You prepared or submitted this version — someone else must decide. Return it to draft instead.");
  await prisma.$transaction(async (tx) => {
    await moveVersion(tx, v, { status: "REJECTED", decidedByUserId: actor.userId, decidedAt: new Date(), decisionComment: reason });
    await event(tx, actor, m.id, "REJECTED", reason, { version: v.versionNumber });
    await audit(tx, actor, VERSION_TABLE, v.id, "REJECT", { status: "PENDING_APPROVAL" }, { status: "REJECTED", reason });
  });
  return { id };
}

/** The model reports open with. One per company (partial unique index). */
export async function setDefaultModel(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "marketing_attribution", "approve");
  const m = await loadModel(actor, id);
  if (m.status !== "ACTIVE") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a model in use can be the default.");
  await prisma.$transaction(async (tx) => {
    await tx.marketingAttributionModel.updateMany({ where: { companyId: actor.companyId, isDefault: true, id: { not: m.id } }, data: { isDefault: false } });
    await tx.marketingAttributionModel.update({ where: { id: m.id }, data: { isDefault: true, updatedByUserId: actor.userId, version: { increment: 1 } } });
    await event(tx, actor, m.id, "SET_DEFAULT");
    await audit(tx, actor, TABLE, m.id, "UPDATE", { isDefault: false }, { isDefault: true });
  });
  return { id };
}

/** Retired models get no new runs; their past runs and results stay. */
export async function retireModel(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_attribution", "edit");
  const { reason } = reasonSchema.parse(raw ?? {});
  const m = await loadModel(actor, id);
  notRetired(m);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.marketingAttributionModel.updateMany({ where: { id: m.id, version: m.version }, data: { status: "RETIRED", isDefault: false, retiredAt: new Date(), updatedByUserId: actor.userId, version: { increment: 1 } } });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This model changed just now. Reload and try again.");
    await event(tx, actor, m.id, "RETIRED", reason);
    await audit(tx, actor, TABLE, m.id, "UPDATE", { status: m.status }, { status: "RETIRED", reason });
  });
  return { id };
}
