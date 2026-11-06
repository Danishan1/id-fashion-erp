import { Prisma, type MarketingSegment, type MarketingSegmentVersion } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { optionalText } from "@/modules/sales-marketing/performance/performance-common";
import {
  assertNotArchived,
  auditSegment,
  definitionHash,
  displayRows,
  getSegmentScope,
  guardedSegmentUpdate,
  loadDisplay,
  loadSegment,
  recordSegmentEvent,
  segmentScopeWhere,
} from "./segment-common";
import {
  MAX_MANUAL_EXCLUSIONS,
  MAX_STATIC_MEMBERS,
  availabilityWhere,
  baseWhere,
  classifyBatch,
  consentCheck,
  criteriaWhere,
  delegate,
  dynamicWheres,
  exclusionWhere,
  getSegmentAccess,
  withStatementTimeout,
  type Classified,
  type CompiledDefinition,
  type SegmentAccess,
  type W,
} from "./segment-query";
import {
  ELIGIBILITY_CHANNEL_KEYS,
  EMPTY_CRITERIA,
  SEGMENT_ACTIONS,
  SEGMENT_SOURCE_KEYS,
  SEGMENT_STATUS_KEYS,
  SEGMENT_TYPE_KEYS,
  validateCriteria,
  type EligibilityChannelKey,
  type SegmentActionKey,
  type SegmentSourceKey,
} from "./segment-registry";

/**
 * Audience segments (Phase 09, PHASE_09_SEGMENTS.md): create / edit details,
 * versioned definitions, lifecycle, duplicate, explicit membership and the
 * live preview. Evaluations / snapshots live in segment-evaluation.service.ts,
 * campaign audiences in campaign-audience.service.ts.
 */

type Db = Prisma.TransactionClient | typeof prisma;
const PREVIEW_PAGE_SIZE = 25;
const PREVIEW_TIMEOUT_MS = 10_000;

const codeSchema = z.string().trim().min(1, "Enter a code").max(40).regex(/^[A-Za-z0-9._-]+$/, "Letters, digits, . _ - only");
const channelSchema = z.enum(ELIGIBILITY_CHANNEL_KEYS).nullable().optional();

export const segmentCreateSchema = z
  .object({
    code: codeSchema,
    name: z.string().trim().min(1, "Enter a name").max(200),
    description: optionalText(2000),
    purpose: optionalText(1000),
    sourceType: z.enum(SEGMENT_SOURCE_KEYS),
    segmentType: z.enum(SEGMENT_TYPE_KEYS),
    ownerUserId: z.string().uuid("Choose an owner"),
    refreshSchedule: z.enum(["MANUAL", "NIGHTLY"]).default("MANUAL"),
    eligibilityChannel: channelSchema,
    criteria: z.unknown().optional(),
    exclusionCriteria: z.unknown().optional(),
    idempotencyKey: z.string().trim().min(8).max(100).optional(),
  })
  .strict();
export const segmentUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(200),
    description: optionalText(2000),
    purpose: optionalText(1000),
    ownerUserId: z.string().uuid("Choose an owner"),
    refreshSchedule: z.enum(["MANUAL", "NIGHTLY"]),
    version: z.number().int().min(1),
  })
  .strict();
export const segmentDefinitionSchema = z
  .object({
    criteria: z.unknown(),
    exclusionCriteria: z.unknown().optional(),
    eligibilityChannel: channelSchema,
    changeNote: optionalText(500),
    version: z.number().int().min(1),
  })
  .strict();
export const segmentDuplicateSchema = z.object({ code: codeSchema, name: z.string().trim().min(1).max(200) }).strict();
export const listSegmentsSchema = z.object({
  status: z.string().optional(),
  sourceType: z.enum(SEGMENT_SOURCE_KEYS).optional().or(z.literal("")),
  segmentType: z.enum(SEGMENT_TYPE_KEYS).optional().or(z.literal("")),
  ownerUserId: z.string().uuid().optional().or(z.literal("")),
  search: z.string().trim().max(100).optional(),
  activeOnly: z.enum(["true", "false"]).optional(),
});
const recordIds = z.array(z.string().uuid()).min(1, "Pick at least one record").max(500, "At most 500 records at a time");
export const addMembersSchema = z.object({ recordIds, kind: z.enum(["INCLUDED", "EXCLUDED"]), reason: optionalText(500) }).strict();
export const removeMembersSchema = z.object({ recordIds, kind: z.enum(["INCLUDED", "EXCLUDED"]) }).strict();
export const previewSchema = z
  .object({
    draft: z.object({ criteria: z.unknown(), exclusionCriteria: z.unknown().optional(), eligibilityChannel: channelSchema }).strict().optional(),
    show: z.enum(["members", "excluded", "ineligible"]).default("members"),
    page: z.number().int().min(1).max(10_000).default(1),
  })
  .strict();

// ── Validation helpers ──────────────────────────────────────────────

async function validateOwner(actor: SalesActor, ownerUserId: string, current?: string) {
  const owner = await prisma.user.findFirst({ where: { id: ownerUserId, companyId: actor.companyId, status: "ACTIVE", supportForPlatformUserId: null }, select: { id: true, fullName: true } });
  if (!owner) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active user as owner.", { fieldErrors: { ownerUserId: "Not an active user." } });
  if (ownerUserId !== current && !(await PermissionService.can(owner.id, "marketing_segments", "view"))) {
    throw new BusinessRuleError("VALIDATION_ERROR", `${owner.fullName} doesn't have access to Audience Segments.`, { fieldErrors: { ownerUserId: "No access to segments." } });
  }
  return owner;
}

/** Normalises and validates a definition for a source/type; throws with every issue listed. */
export function normaliseDefinition(source: SegmentSourceKey, segmentType: "DYNAMIC" | "STATIC", raw: { criteria?: unknown; exclusionCriteria?: unknown; eligibilityChannel?: EligibilityChannelKey | null }) {
  const crit = segmentType === "STATIC" ? { criteria: EMPTY_CRITERIA, issues: [] } : validateCriteria(source, raw.criteria ?? EMPTY_CRITERIA);
  const excl = validateCriteria(source, raw.exclusionCriteria ?? EMPTY_CRITERIA);
  const issues = [...crit.issues.map((i) => ({ ...i, part: "criteria" as const })), ...excl.issues.map((i) => ({ ...i, part: "exclusions" as const }))];
  if (issues.length) throw new BusinessRuleError("VALIDATION_ERROR", issues[0].message, { issues });
  const exclusionCriteria = excl.criteria.groups.length ? excl.criteria : null;
  const eligibilityChannel = raw.eligibilityChannel ?? null;
  return { criteria: crit.criteria, exclusionCriteria, eligibilityChannel, hash: definitionHash({ criteria: crit.criteria, exclusionCriteria, eligibilityChannel }) };
}

/** Builds the compiled (query-ready) definition for a segment, its saved version or a posted draft. */
export async function compileDefinition(db: Db, access: SegmentAccess, seg: Pick<MarketingSegment, "id" | "segmentType">, def: { criteria: unknown; exclusionCriteria: unknown; eligibilityChannel: string | null }): Promise<CompiledDefinition> {
  const manual = await db.marketingSegmentMember.findMany({ where: { segmentId: seg.id, kind: "EXCLUDED", removedAt: null }, select: { recordId: true }, take: MAX_MANUAL_EXCLUSIONS });
  return {
    access,
    segmentType: seg.segmentType,
    criteria: seg.segmentType === "DYNAMIC" ? await criteriaWhere(db, access, def.criteria) : {},
    exclusion: await exclusionWhere(db, access, def.exclusionCriteria),
    manualExclusionIds: manual.map((m) => m.recordId),
    channel: (def.eligibilityChannel as EligibilityChannelKey | null) ?? null,
  };
}

export async function currentVersion(db: Db, seg: Pick<MarketingSegment, "id" | "currentVersionNumber">): Promise<MarketingSegmentVersion> {
  const v = await db.marketingSegmentVersion.findUnique({ where: { segmentId_versionNumber: { segmentId: seg.id, versionNumber: seg.currentVersionNumber } } });
  if (!v) throw new BusinessRuleError("NOT_FOUND", "The segment's definition is missing.");
  return v;
}

// ── Create / edit / definition ──────────────────────────────────────

export async function createSegment(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_segments", "create");
  const input = segmentCreateSchema.parse(raw);
  if (input.idempotencyKey) {
    const existing = await prisma.marketingSegment.findFirst({ where: { companyId: actor.companyId, idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;
  }
  await validateOwner(actor, input.ownerUserId);
  // The creator must be able to read the source itself (CRM / customers).
  await getSegmentAccess(actor.companyId, actor.userId, input.sourceType);
  const def = normaliseDefinition(input.sourceType, input.segmentType, input);
  const code = input.code.toUpperCase();
  if (await prisma.marketingSegment.findFirst({ where: { companyId: actor.companyId, code }, select: { id: true } })) {
    throw new BusinessRuleError("VALIDATION_ERROR", `A segment with code ${code} already exists.`, { fieldErrors: { code: "Already used." } });
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const seg = await tx.marketingSegment.create({
        data: {
          companyId: actor.companyId,
          code,
          name: input.name,
          description: input.description || null,
          purpose: input.purpose || null,
          sourceType: input.sourceType,
          segmentType: input.segmentType,
          ownerUserId: input.ownerUserId,
          refreshSchedule: input.refreshSchedule,
          idempotencyKey: input.idempotencyKey ?? null,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
      });
      await tx.marketingSegmentVersion.create({
        data: {
          segmentId: seg.id,
          versionNumber: 1,
          criteria: def.criteria as unknown as Prisma.InputJsonValue,
          exclusionCriteria: def.exclusionCriteria ? (def.exclusionCriteria as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          eligibilityChannel: def.eligibilityChannel,
          definitionHash: def.hash,
          createdByUserId: actor.userId,
        },
      });
      await auditSegment(tx, actor, seg.id, "CREATE", null, { code, name: seg.name, sourceType: seg.sourceType, segmentType: seg.segmentType, definition: def });
      await recordSegmentEvent(tx, actor, seg.id, "CREATED", null, { versionNumber: 1 });
      return seg;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      if (input.idempotencyKey) {
        const existing = await prisma.marketingSegment.findFirst({ where: { companyId: actor.companyId, idempotencyKey: input.idempotencyKey } });
        if (existing) return existing;
      }
      throw new BusinessRuleError("VALIDATION_ERROR", `A segment with code ${code} already exists.`, { fieldErrors: { code: "Already used." } });
    }
    throw e;
  }
}

export async function updateSegment(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_segments", "edit");
  const input = segmentUpdateSchema.parse(raw);
  const seg = await loadSegment(actor, id);
  if (seg.companyId !== actor.companyId) throw new BusinessRuleError("NOT_FOUND", "Segment not found.");
  assertNotArchived(seg);
  if (seg.version !== input.version) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This segment was changed by someone else. Reload and try again.");
  await validateOwner(actor, input.ownerUserId, seg.ownerUserId);
  const data = { name: input.name, description: input.description || null, purpose: input.purpose || null, ownerUserId: input.ownerUserId, refreshSchedule: input.refreshSchedule };
  await prisma.$transaction(async (tx) => {
    await guardedSegmentUpdate(tx, actor, seg, data);
    await auditSegment(tx, actor, seg.id, "UPDATE", { name: seg.name, description: seg.description, purpose: seg.purpose, ownerUserId: seg.ownerUserId, refreshSchedule: seg.refreshSchedule }, data);
    if (seg.ownerUserId !== input.ownerUserId) await recordSegmentEvent(tx, actor, seg.id, "OWNER_CHANGED", null, { from: seg.ownerUserId, to: input.ownerUserId });
  });
  return loadSegment(actor, id);
}

/**
 * Saves the rules. An unchanged definition is a no-op; anything else adds
 * version N+1 (immutable) and supersedes queued evaluations of older versions
 * — running ones notice the newer version when they finish.
 */
export async function saveSegmentDefinition(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_segments", "edit");
  const input = segmentDefinitionSchema.parse(raw);
  const seg = await loadSegment(actor, id);
  assertNotArchived(seg);
  if (seg.version !== input.version) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This segment was changed by someone else. Reload and try again.");
  await getSegmentAccess(actor.companyId, actor.userId, seg.sourceType);
  const def = normaliseDefinition(seg.sourceType, seg.segmentType, input);
  const current = await currentVersion(prisma, seg);
  if (current.definitionHash === def.hash) return { segment: seg, changed: false, versionNumber: current.versionNumber };
  const next = seg.currentVersionNumber + 1;
  await prisma.$transaction(async (tx) => {
    await guardedSegmentUpdate(tx, actor, seg, { currentVersionNumber: next });
    await tx.marketingSegmentVersion.create({
      data: {
        segmentId: seg.id,
        versionNumber: next,
        criteria: def.criteria as unknown as Prisma.InputJsonValue,
        exclusionCriteria: def.exclusionCriteria ? (def.exclusionCriteria as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        eligibilityChannel: def.eligibilityChannel,
        definitionHash: def.hash,
        changeNote: input.changeNote || null,
        createdByUserId: actor.userId,
      },
    });
    await tx.marketingSegmentEvaluation.updateMany({ where: { segmentId: seg.id, status: "QUEUED", versionNumber: { lt: next } }, data: { status: "SUPERSEDED", finishedAt: new Date(), error: "The definition changed before this evaluation started." } });
    await auditSegment(
      tx,
      actor,
      seg.id,
      "UPDATE",
      { versionNumber: current.versionNumber, criteria: current.criteria, exclusionCriteria: current.exclusionCriteria, eligibilityChannel: current.eligibilityChannel },
      { versionNumber: next, criteria: def.criteria, exclusionCriteria: def.exclusionCriteria, eligibilityChannel: def.eligibilityChannel },
      "marketing_segment_versions"
    );
    await recordSegmentEvent(tx, actor, seg.id, "DEFINITION_CHANGED", input.changeNote || null, { fromVersion: current.versionNumber, toVersion: next });
  });
  return { segment: await loadSegment(actor, id), changed: true, versionNumber: next };
}

/** Pure check for the builder (no saving). */
export async function validateSegmentDefinition(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_segments", "view");
  const input = z.object({ sourceType: z.enum(SEGMENT_SOURCE_KEYS), segmentType: z.enum(SEGMENT_TYPE_KEYS), criteria: z.unknown(), exclusionCriteria: z.unknown().optional() }).parse(raw);
  const crit = input.segmentType === "STATIC" ? { issues: [] } : validateCriteria(input.sourceType, input.criteria);
  const excl = validateCriteria(input.sourceType, input.exclusionCriteria ?? EMPTY_CRITERIA);
  return { valid: !crit.issues.length && !excl.issues.length, criteriaIssues: crit.issues, exclusionIssues: excl.issues };
}

// ── Lifecycle / duplicate ───────────────────────────────────────────

/** Campaigns still running / planned that use a segment block archiving it. */
async function liveCampaignUses(companyId: string, segmentId: string) {
  return prisma.marketingCampaignAudience.findMany({
    where: { companyId, segmentId, campaign: { status: { notIn: ["COMPLETED", "CANCELLED"] } } },
    select: { campaign: { select: { code: true, name: true, status: true } } },
    take: 5,
  });
}

export async function segmentAction(actor: SalesActor, id: string, action: SegmentActionKey, raw: unknown) {
  const spec = SEGMENT_ACTIONS[action];
  if (!spec) throw new BusinessRuleError("NOT_FOUND", "Unknown action.");
  await PermissionService.assert(actor.userId, "marketing_segments", action === "archive" ? "delete" : "edit");
  const { reason } = z.object({ reason: optionalText(1000) }).strict().parse(raw ?? {});
  const seg = await loadSegment(actor, id);
  if (!(spec.from as readonly string[]).includes(seg.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Can't ${spec.label.toLowerCase()} a segment that is ${seg.status.toLowerCase()}.`);
  if (action === "archive") {
    const uses = await liveCampaignUses(actor.companyId, seg.id);
    if (uses.length) throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", `Remove it from ${uses.map((u) => u.campaign.code).join(", ")} first — those campaigns are still planned or running.`);
  }
  await prisma.$transaction(async (tx) => {
    await guardedSegmentUpdate(tx, actor, seg, { status: spec.to });
    if (action === "archive") await tx.marketingSegmentEvaluation.updateMany({ where: { segmentId: seg.id, status: "QUEUED" }, data: { status: "SUPERSEDED", finishedAt: new Date(), error: "The segment was archived." } });
    await auditSegment(tx, actor, seg.id, "UPDATE", { status: seg.status }, { status: spec.to, reason: reason || null });
    await recordSegmentEvent(tx, actor, seg.id, action.toUpperCase(), reason || null, { from: seg.status, to: spec.to });
  });
  return loadSegment(actor, id);
}

export async function duplicateSegment(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_segments", "create");
  const input = segmentDuplicateSchema.parse(raw);
  const seg = await loadSegment(actor, id);
  const version = await currentVersion(prisma, seg);
  const created = await createSegment(actor, {
    code: input.code,
    name: input.name,
    description: seg.description,
    purpose: seg.purpose,
    sourceType: seg.sourceType,
    segmentType: seg.segmentType,
    ownerUserId: actor.userId,
    refreshSchedule: seg.refreshSchedule,
    eligibilityChannel: version.eligibilityChannel,
    criteria: version.criteria,
    exclusionCriteria: version.exclusionCriteria ?? undefined,
  });
  const live = await prisma.marketingSegmentMember.findMany({ where: { segmentId: seg.id, removedAt: null }, select: { recordId: true, kind: true, reason: true } });
  await prisma.$transaction(async (tx) => {
    if (live.length) {
      await tx.marketingSegmentMember.createMany({
        data: live.map((m) => ({ segmentId: created.id, recordId: m.recordId, kind: m.kind, reason: m.reason, source: "DUPLICATE", addedByUserId: actor.userId })),
        skipDuplicates: true,
      });
    }
    await recordSegmentEvent(tx, actor, created.id, "DUPLICATED_FROM", null, { segmentId: seg.id, code: seg.code, members: live.length });
  });
  return created;
}

// ── List / detail ───────────────────────────────────────────────────

export async function listSegments(actor: SalesActor, raw: unknown, page = 1, pageSize = 25) {
  await PermissionService.assert(actor.userId, "marketing_segments", "view");
  const f = listSegmentsSchema.parse(raw);
  const scope = await getSegmentScope(actor);
  const and: Prisma.MarketingSegmentWhereInput[] = [segmentScopeWhere(actor, scope)];
  const statuses = (f.status ?? "").split(",").filter((s) => (SEGMENT_STATUS_KEYS as readonly string[]).includes(s)) as MarketingSegment["status"][];
  if (statuses.length) and.push({ status: { in: statuses } });
  else if (f.activeOnly === "true") and.push({ status: { not: "ARCHIVED" } });
  if (f.sourceType) and.push({ sourceType: f.sourceType });
  if (f.segmentType) and.push({ segmentType: f.segmentType });
  if (f.ownerUserId) and.push({ ownerUserId: f.ownerUserId });
  if (f.search) and.push({ OR: [{ name: { contains: f.search, mode: "insensitive" } }, { code: { contains: f.search, mode: "insensitive" } }] });
  const where: Prisma.MarketingSegmentWhereInput = { AND: and };
  const [total, rows] = await Promise.all([
    prisma.marketingSegment.count({ where }),
    prisma.marketingSegment.findMany({ where, orderBy: [{ updatedAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize, include: { owner: { select: { fullName: true } } } }),
  ]);
  return {
    data: rows.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      sourceType: s.sourceType,
      segmentType: s.segmentType,
      status: s.status,
      owner: s.owner.fullName,
      memberCount: s.memberCount,
      lastEvaluatedAt: s.lastEvaluatedAt?.toISOString() ?? null,
      lastEvaluationStatus: s.lastEvaluationStatus,
      currentVersionNumber: s.currentVersionNumber,
    })),
    meta: { page, pageSize, totalCount: total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function getSegment(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "marketing_segments", "view");
  const seg = await loadSegment(actor, id);
  const [full, versions, evaluations, memberCounts, lastMemberChange, campaigns, events] = await Promise.all([
    prisma.marketingSegment.findUniqueOrThrow({ where: { id: seg.id }, include: { owner: { select: { id: true, fullName: true } }, createdBy: { select: { fullName: true } } } }),
    prisma.marketingSegmentVersion.findMany({ where: { segmentId: seg.id }, orderBy: { versionNumber: "desc" }, take: 50 }),
    prisma.marketingSegmentEvaluation.findMany({ where: { segmentId: seg.id }, orderBy: { requestedAt: "desc" }, take: 25 }),
    prisma.marketingSegmentMember.groupBy({ by: ["kind"], where: { segmentId: seg.id, removedAt: null }, _count: { _all: true } }),
    prisma.marketingSegmentMember.findFirst({ where: { segmentId: seg.id }, orderBy: [{ removedAt: { sort: "desc", nulls: "last" } }], select: { addedAt: true, removedAt: true } }),
    prisma.marketingCampaignAudience.findMany({ where: { segmentId: seg.id }, include: { campaign: { select: { id: true, code: true, name: true, status: true } } } }),
    import("./segment-common").then((m) => m.listSegmentEvents(actor.companyId, seg.id)),
  ]);
  const latestAdded = await prisma.marketingSegmentMember.findFirst({ where: { segmentId: seg.id }, orderBy: { addedAt: "desc" }, select: { addedAt: true } });
  const membersChangedAt = [latestAdded?.addedAt, lastMemberChange?.removedAt].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const userIds = [...new Set([...versions.map((v) => v.createdByUserId), ...evaluations.map((e) => e.requestedByUserId).filter((x): x is string => Boolean(x)), ...evaluations.map((e) => e.runAsUserId)])];
  const users = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const lastCompleted = evaluations.find((e) => e.id === full.lastEvaluationId) ?? null;
  const current = versions.find((v) => v.versionNumber === full.currentVersionNumber) ?? null;
  const canEdit = await PermissionService.can(actor.userId, "marketing_segments", "edit");
  return {
    id: full.id,
    code: full.code,
    name: full.name,
    description: full.description,
    purpose: full.purpose,
    sourceType: full.sourceType,
    segmentType: full.segmentType,
    status: full.status,
    owner: full.owner,
    createdBy: full.createdBy.fullName,
    createdAt: full.createdAt.toISOString(),
    refreshSchedule: full.refreshSchedule,
    version: full.version,
    currentVersionNumber: full.currentVersionNumber,
    definition: current ? { criteria: current.criteria, exclusionCriteria: current.exclusionCriteria, eligibilityChannel: current.eligibilityChannel } : null,
    consentCheck: consentCheck(full.sourceType, (current?.eligibilityChannel as EligibilityChannelKey | null) ?? null),
    summary: {
      memberCount: full.memberCount,
      lastEvaluatedAt: full.lastEvaluatedAt?.toISOString() ?? null,
      lastEvaluationId: full.lastEvaluationId,
      lastEvaluationStatus: full.lastEvaluationStatus,
      lastError: full.lastError,
      lastCompletedVersion: lastCompleted?.versionNumber ?? null,
      /** The saved definition or the member list changed after the last completed snapshot. */
      definitionChangedSinceEvaluation: lastCompleted ? lastCompleted.versionNumber !== full.currentVersionNumber : false,
      membersChangedSinceEvaluation: Boolean(lastCompleted?.finishedAt && membersChangedAt && membersChangedAt > lastCompleted.finishedAt),
    },
    memberCounts: {
      included: memberCounts.find((m) => m.kind === "INCLUDED")?._count._all ?? 0,
      excluded: memberCounts.find((m) => m.kind === "EXCLUDED")?._count._all ?? 0,
    },
    versions: versions.map((v) => ({
      versionNumber: v.versionNumber,
      criteria: v.criteria,
      exclusionCriteria: v.exclusionCriteria,
      eligibilityChannel: v.eligibilityChannel,
      changeNote: v.changeNote,
      createdAt: v.createdAt.toISOString(),
      createdBy: users.get(v.createdByUserId) ?? "—",
    })),
    evaluations: evaluations.map((e) => evaluationView(e, users)),
    campaigns: campaigns.map((c) => ({ id: c.campaign.id, code: c.campaign.code, name: c.campaign.name, status: c.campaign.status, role: c.role, pinnedEvaluationId: c.pinnedEvaluationId })),
    events,
    canEdit,
  };
}

export function evaluationView(
  e: Prisma.MarketingSegmentEvaluationGetPayload<object>,
  users: Map<string, string>
) {
  return {
    id: e.id,
    versionNumber: e.versionNumber,
    status: e.status,
    trigger: e.trigger,
    runAs: users.get(e.runAsUserId) ?? "—",
    requestedBy: e.requestedByUserId ? (users.get(e.requestedByUserId) ?? "—") : "Scheduled",
    matchedCount: e.matchedCount,
    excludedCount: e.excludedCount,
    ineligibleCount: e.ineligibleCount,
    memberCount: e.memberCount,
    isKept: e.isKept,
    label: e.label,
    entriesPurged: Boolean(e.entriesPurgedAt),
    error: e.error,
    requestedAt: e.requestedAt.toISOString(),
    startedAt: e.startedAt?.toISOString() ?? null,
    finishedAt: e.finishedAt?.toISOString() ?? null,
  };
}

// ── Explicit membership ─────────────────────────────────────────────

export async function addSegmentMembers(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_segments", "edit");
  const input = addMembersSchema.parse(raw);
  const seg = await loadSegment(actor, id);
  assertNotArchived(seg);
  if (seg.segmentType === "DYNAMIC" && input.kind === "INCLUDED") throw new BusinessRuleError("VALIDATION_ERROR", "Dynamic segments get their members from the rules — you can only exclude records by hand.");
  const access = await getSegmentAccess(actor.companyId, actor.userId, seg.sourceType);
  const ids = [...new Set(input.recordIds)];
  // Only records that exist, are available and are visible to the person adding them.
  const visible = new Set((await delegate(prisma, seg.sourceType).findMany({ where: { AND: [baseWhere(access), { id: { in: ids } }] }, select: { id: true } })).map((r) => r.id));
  const rejected = ids.filter((rid) => !visible.has(rid));
  const accepted = ids.filter((rid) => visible.has(rid));
  const live = await prisma.marketingSegmentMember.findMany({ where: { segmentId: seg.id, removedAt: null, recordId: { in: accepted } }, select: { recordId: true, kind: true } });
  const sameKind = new Set(live.filter((m) => m.kind === input.kind).map((m) => m.recordId));
  const otherKind = live.filter((m) => m.kind !== input.kind).map((m) => m.recordId);
  const toAdd = accepted.filter((rid) => !sameKind.has(rid));
  const limit = input.kind === "INCLUDED" ? MAX_STATIC_MEMBERS : MAX_MANUAL_EXCLUSIONS;
  const currentCount = await prisma.marketingSegmentMember.count({ where: { segmentId: seg.id, removedAt: null, kind: input.kind } });
  if (currentCount + toAdd.length > limit) {
    throw new BusinessRuleError("VALIDATION_ERROR", `A segment can hold at most ${limit.toLocaleString("en-IN")} ${input.kind === "INCLUDED" ? "members" : "manual exclusions"}.`);
  }
  if (toAdd.length) {
    await prisma.$transaction(async (tx) => {
      // A record moves between included / excluded: close its other live row first (history kept).
      if (otherKind.length) await tx.marketingSegmentMember.updateMany({ where: { segmentId: seg.id, removedAt: null, recordId: { in: otherKind } }, data: { removedAt: new Date(), removedByUserId: actor.userId } });
      await tx.marketingSegmentMember.createMany({
        data: toAdd.map((recordId) => ({ segmentId: seg.id, recordId, kind: input.kind, reason: input.reason || null, source: ids.length > 1 ? "BULK" : "MANUAL", addedByUserId: actor.userId })),
        skipDuplicates: true,
      });
      await auditSegment(tx, actor, seg.id, "UPDATE", null, { membersAdded: toAdd.length, kind: input.kind, reason: input.reason || null }, "marketing_segment_members");
      await recordSegmentEvent(tx, actor, seg.id, input.kind === "INCLUDED" ? "MEMBERS_ADDED" : "EXCLUSIONS_ADDED", input.reason || null, { count: toAdd.length, recordIds: toAdd.slice(0, 50) });
    });
  }
  return { added: toAdd.length, alreadyPresent: accepted.length - toAdd.length, rejected: rejected.length, rejectedIds: rejected };
}

export async function removeSegmentMembers(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_segments", "edit");
  const input = removeMembersSchema.parse(raw);
  const seg = await loadSegment(actor, id);
  assertNotArchived(seg);
  const removed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.marketingSegmentMember.updateMany({ where: { segmentId: seg.id, removedAt: null, kind: input.kind, recordId: { in: input.recordIds } }, data: { removedAt: new Date(), removedByUserId: actor.userId } });
    if (count) {
      await auditSegment(tx, actor, seg.id, "UPDATE", null, { membersRemoved: count, kind: input.kind }, "marketing_segment_members");
      await recordSegmentEvent(tx, actor, seg.id, input.kind === "INCLUDED" ? "MEMBERS_REMOVED" : "EXCLUSIONS_REMOVED", null, { count, recordIds: input.recordIds.slice(0, 50) });
    }
    return count;
  });
  return { removed };
}

/** Live member list (current state) with who added each row. */
export async function listSegmentMembers(actor: SalesActor, id: string, kind: "INCLUDED" | "EXCLUDED", page = 1, pageSize = 25, includeRemoved = false) {
  await PermissionService.assert(actor.userId, "marketing_segments", "view");
  const seg = await loadSegment(actor, id);
  const where: Prisma.MarketingSegmentMemberWhereInput = { segmentId: seg.id, kind, ...(includeRemoved ? {} : { removedAt: null }) };
  const [total, rows] = await Promise.all([
    prisma.marketingSegmentMember.count({ where }),
    prisma.marketingSegmentMember.findMany({ where, orderBy: { addedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  const display = await loadDisplay(prisma, actor.companyId, seg.sourceType, rows.map((r) => r.recordId));
  const userIds = [...new Set(rows.flatMap((r) => [r.addedByUserId, r.removedByUserId].filter((x): x is string => Boolean(x))))];
  const users = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  // Visibility: only show names of records the viewer may see; others are counted, not named.
  let visible = new Set<string>();
  try {
    const access = await getSegmentAccess(actor.companyId, actor.userId, seg.sourceType);
    visible = new Set((await delegate(prisma, seg.sourceType).findMany({ where: { AND: [baseWhere(access), { id: { in: rows.map((r) => r.recordId) } }] }, select: { id: true } })).map((r) => r.id));
  } catch {
    visible = new Set();
  }
  return {
    data: rows.map((r) => {
      const d = displayRows([r.recordId], display)[0];
      const shown = visible.has(r.recordId) ? d : { ...d, name: "(not visible to you)", organization: null, owner: null, location: null, href: "" };
      return { ...shown, memberId: r.id, reason: r.reason, source: r.source, addedAt: r.addedAt.toISOString(), addedBy: users.get(r.addedByUserId) ?? "—", removedAt: r.removedAt?.toISOString() ?? null, removedBy: r.removedByUserId ? (users.get(r.removedByUserId) ?? "—") : null };
    }),
    meta: { page, pageSize, totalCount: total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

const SEARCH_FIELDS: Record<SegmentSourceKey, string[]> = {
  CONTACT: ["fullName", "email"],
  COMPANY: ["name", "legalName"],
  LEAD: ["fullName", "companyName", "leadNumber"],
  CUSTOMER: ["name", "code"],
};
const ORDER_FIELD: Record<SegmentSourceKey, string> = { CONTACT: "fullName", COMPANY: "name", LEAD: "fullName", CUSTOMER: "name" };

/** Records the user could add (search within their own visible records). */
export async function searchSegmentCandidates(actor: SalesActor, id: string, search: string) {
  await PermissionService.assert(actor.userId, "marketing_segments", "view");
  const seg = await loadSegment(actor, id);
  const access = await getSegmentAccess(actor.companyId, actor.userId, seg.sourceType);
  const term = search.trim().slice(0, 100);
  const where: W = { AND: [baseWhere(access), ...(term ? [{ OR: SEARCH_FIELDS[seg.sourceType].map((f) => ({ [f]: { contains: term, mode: "insensitive" } })) }] : [])] };
  const rows = await delegate(prisma, seg.sourceType).findMany({ where, select: { id: true }, orderBy: { [ORDER_FIELD[seg.sourceType]]: "asc" }, take: 25 });
  const ids = rows.map((r) => r.id);
  const [display, live] = await Promise.all([
    loadDisplay(prisma, actor.companyId, seg.sourceType, ids),
    prisma.marketingSegmentMember.findMany({ where: { segmentId: seg.id, removedAt: null, recordId: { in: ids } }, select: { recordId: true, kind: true } }),
  ]);
  const kinds = new Map(live.map((m) => [m.recordId, m.kind]));
  return displayRows(ids, display).map((d) => ({ ...d, membership: kinds.get(d.id) ?? null }));
}

// ── Live preview ────────────────────────────────────────────────────

async function classifyAll(db: Db, def: CompiledDefinition, ids: string[], origin: "CRITERIA" | "STATIC") {
  const out: Classified[] = [];
  for (let i = 0; i < ids.length; i += 1000) out.push(...(await classifyBatch(db, def, ids.slice(i, i + 1000), origin)));
  return out;
}

/**
 * Live preview of the saved definition, or of an unsaved draft. Never writes
 * anything and is clearly labelled "live" — it is not a snapshot. Dynamic
 * segments are counted in the database (paged sample); static ones classify
 * their explicit members (bounded by MAX_STATIC_MEMBERS).
 */
export async function previewSegment(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_segments", "view");
  const input = previewSchema.parse(raw ?? {});
  const seg = await loadSegment(actor, id);
  const access = await getSegmentAccess(actor.companyId, actor.userId, seg.sourceType);
  const saved = await currentVersion(prisma, seg);
  const def = input.draft ? normaliseDefinition(seg.sourceType, seg.segmentType, input.draft) : { criteria: saved.criteria, exclusionCriteria: saved.exclusionCriteria, eligibilityChannel: saved.eligibilityChannel };
  const pageSize = PREVIEW_PAGE_SIZE;
  const result = await withStatementTimeout(PREVIEW_TIMEOUT_MS, async (tx) => {
    const compiled = await compileDefinition(tx, access, seg, def);
    const d = delegate(tx, seg.sourceType);
    if (seg.segmentType === "DYNAMIC") {
      const w = dynamicWheres(compiled);
      const [matched, excluded, ineligible, members] = await Promise.all([
        d.count({ where: w.matched }),
        w.excluded ? d.count({ where: w.excluded }) : 0,
        w.ineligible ? d.count({ where: w.ineligible }) : 0,
        d.count({ where: w.members }),
      ]);
      const listWhere = input.show === "excluded" ? w.excluded : input.show === "ineligible" ? w.ineligible : w.members;
      const listTotal = input.show === "excluded" ? excluded : input.show === "ineligible" ? ineligible : members;
      const ids = listWhere ? (await d.findMany({ where: listWhere, select: { id: true }, orderBy: [{ [ORDER_FIELD[seg.sourceType]]: "asc" }, { id: "asc" }], skip: (input.page - 1) * pageSize, take: pageSize })).map((r) => r.id) : [];
      const classified = ids.length ? await classifyBatch(tx, compiled, ids, "CRITERIA") : [];
      return { counts: { matched, excluded, ineligible, members }, ids, classified, listTotal };
    }
    const memberIds = (await tx.marketingSegmentMember.findMany({ where: { segmentId: seg.id, kind: "INCLUDED", removedAt: null }, select: { recordId: true }, orderBy: { addedAt: "desc" }, take: MAX_STATIC_MEMBERS })).map((m) => m.recordId);
    const all = await classifyAll(tx, compiled, memberIds, "STATIC");
    const wanted = all.filter((c) => (input.show === "members" ? c.outcome === "INCLUDED" : input.show === "excluded" ? c.outcome === "EXCLUDED" : c.outcome === "INELIGIBLE"));
    const page = wanted.slice((input.page - 1) * pageSize, input.page * pageSize);
    return {
      counts: { matched: memberIds.length, excluded: all.filter((c) => c.outcome === "EXCLUDED").length, ineligible: all.filter((c) => c.outcome === "INELIGIBLE").length, members: all.filter((c) => c.outcome === "INCLUDED").length },
      ids: page.map((c) => c.recordId),
      classified: page,
      listTotal: wanted.length,
    };
  });
  const display = await loadDisplay(prisma, actor.companyId, seg.sourceType, result.ids);
  const outcome = new Map(result.classified.map((c) => [c.recordId, c]));
  return {
    kind: "LIVE" as const,
    computedAt: new Date().toISOString(),
    usingDraft: Boolean(input.draft),
    counts: result.counts,
    consentCheck: consentCheck(seg.sourceType, (def.eligibilityChannel as EligibilityChannelKey | null) ?? null),
    show: input.show,
    rows: displayRows(result.ids, display).map((r) => ({ ...r, outcome: outcome.get(r.id)?.outcome ?? null, reason: outcome.get(r.id)?.reason ?? null })),
    meta: { page: input.page, pageSize, totalCount: result.listTotal, totalPages: Math.max(1, Math.ceil(result.listTotal / pageSize)) },
  };
}

/** For other modules / tests: is a record id available in a source at all? */
export async function recordAvailable(companyId: string, source: SegmentSourceKey, recordId: string) {
  return Boolean(await delegate(prisma, source).findMany({ where: { AND: [availabilityWhere(source, companyId), { id: recordId }] }, select: { id: true }, take: 1 }).then((r) => r[0]));
}
