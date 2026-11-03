import { Prisma, type SalesTarget, type SalesTargetRevision } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { todayIsoDate } from "@/lib/date";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { canSeeRep, canSeeTeam, canSeeTerritory, getPerformanceScope, metricTotals, sumKeys, teamMemberIds, type MetricTotals, type PerformanceScope } from "./performance-actuals";
import { auditPerformance, blank, commentSchema, dbDate, isoDateSchema, listPerformanceEvents, optionalText, reasonSchema, recordPerformanceEvent, toDbDate } from "./performance-common";
import { attainment, isPeriodStart, periodContaining, periodLabel, periodProgress } from "./performance-periods";
import { METRIC_KEYS, metricDefinition, SCOPE_LABELS, type SalesTargetMetricKey, type SalesTargetPeriodTypeKey, type SalesTargetScopeKey } from "./performance-registry";
import { assertEligibleRep } from "./territory.service";

/**
 * Sales targets (Phase 05, PHASE_05 §5–§6): scope + subject + metric + one
 * whole period, with approved revisions (approver ≠ preparer). Actuals always
 * come from performance-actuals.ts.
 */

const TABLE = "sales_targets";
const MAX_VALUE = 99_999_999_999.99;

const scopeEnum = z.enum(["REP", "TEAM", "TERRITORY", "COMPANY"]);
const periodEnum = z.enum(["MONTH", "QUARTER", "YEAR"]);
const metricEnum = z.enum(METRIC_KEYS);
const valueSchema = z.coerce.number().min(0, "Can't be negative").max(MAX_VALUE);

export const targetCreateSchema = z
  .object({
    scope: scopeEnum,
    userId: z.string().uuid().optional().or(z.literal("")).nullable(),
    territoryId: z.string().uuid().optional().or(z.literal("")).nullable(),
    metric: metricEnum,
    periodType: periodEnum,
    periodStart: isoDateSchema,
    targetValue: valueSchema,
    name: optionalText(200),
    notes: optionalText(2000),
  })
  .strict();
export const revisionSaveSchema = z.object({ targetValue: valueSchema, notes: optionalText(2000), version: z.number().int().min(1) }).strict();

// ── Helpers ──────────────────────────────────────────────────────

async function fiscalStartMonth(companyId: string) {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { fiscalYearStartMonth: true, baseCurrencyCode: true } });
  if (!c) throw new BusinessRuleError("NOT_FOUND", "Company not found.");
  return c;
}

function checkValue(metric: SalesTargetMetricKey, value: number) {
  const unit = metricDefinition(metric).unit;
  if (unit === "CURRENCY") {
    if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) throw new BusinessRuleError("VALIDATION_ERROR", "Up to 2 decimals.", { fieldErrors: { targetValue: "Up to 2 decimals." } });
  } else if (!Number.isInteger(value)) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Enter a whole number.", { fieldErrors: { targetValue: "Whole number." } });
  }
}

function uniqueViolation(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = JSON.stringify(error.meta ?? {});
    if (target.includes("one_live")) throw new BusinessRuleError("VALIDATION_ERROR", "A target for this person / team / territory, metric and period already exists. Open it and start a new revision instead.");
    if (target.includes("one_open")) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This target already has a draft or pending revision.");
    throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This target changed just now. Reload and try again.");
  }
  throw error;
}

/** Can the viewer see this target (PHASE_05 §7)? */
export function canSeeTarget(scope: PerformanceScope, t: Pick<SalesTarget, "scope" | "userId" | "territoryId">) {
  if (scope.viewAll) return true;
  if (t.scope === "REP") return Boolean(t.userId) && canSeeRep(scope, t.userId!);
  if (t.scope === "TEAM") return Boolean(t.userId) && canSeeTeam(scope, t.userId!);
  if (t.scope === "TERRITORY") return Boolean(t.territoryId) && canSeeTerritory(scope, t.territoryId!);
  return false;
}

async function loadTarget(actor: SalesActor, id: string) {
  const t = await prisma.salesTarget.findFirst({ where: { id, companyId: actor.companyId } });
  if (!t) throw new BusinessRuleError("NOT_FOUND", "Target not found.", { id });
  const scope = await getPerformanceScope(actor);
  if (!canSeeTarget(scope, t)) throw new BusinessRuleError("NOT_FOUND", "Target not found.", { id });
  return t;
}

async function loadRevision(actor: SalesActor, targetId: string, revisionId: string) {
  const target = await loadTarget(actor, targetId);
  const revision = await prisma.salesTargetRevision.findFirst({ where: { id: revisionId, targetId: target.id } });
  if (!revision) throw new BusinessRuleError("NOT_FOUND", "Revision not found.", { revisionId });
  return { target, revision };
}

async function guardedMove(tx: Prisma.TransactionClient, revision: SalesTargetRevision, data: Prisma.SalesTargetRevisionUncheckedUpdateManyInput) {
  const { count } = await tx.salesTargetRevision.updateMany({ where: { id: revision.id, status: revision.status, version: revision.version }, data: { ...data, version: { increment: 1 } } });
  if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This revision changed just now. Reload and try again.");
}

function requireStatus(revision: SalesTargetRevision, allowed: string[], verb: string) {
  if (!allowed.includes(revision.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `A ${revision.status.toLowerCase().replace(/_/g, " ")} revision can't be ${verb}.`, { status: revision.status });
}

function requireOpenPeriod(target: SalesTarget, verb: string) {
  if (target.isArchived) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This target is archived.");
  if (dbDate(target.periodEnd) < todayIsoDate()) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `The period has ended, so the target can't be ${verb} any more (no changes to past targets).`);
}

/** True when `userId` may approve: holds sales_performance.approve and didn't create, save or submit the revision. */
export async function canApproveTarget(userId: string, involved: (string | null)[]) {
  const people = [...new Set(involved.filter((v): v is string => Boolean(v)))];
  if (!people.length) return PermissionService.can(userId, "sales_performance", "approve");
  for (const createdBy of people) if (!(await PermissionService.can(userId, "sales_performance", "approve", { createdBy }))) return false;
  return true;
}

async function notifyApprovers(tx: Prisma.TransactionClient, actor: SalesActor, exclude: (string | null)[], title: string, body: string) {
  const users = await prisma.user.findMany({ where: { companyId: actor.companyId, status: "ACTIVE", supportForPlatformUserId: null }, select: { id: true } });
  const ok = await Promise.all(users.map((u) => PermissionService.can(u.id, "sales_performance", "approve")));
  for (const u of users.filter((x, i) => ok[i] && !exclude.includes(x.id))) await createNotification({ companyId: actor.companyId, userId: u.id, title, body }, tx);
}

async function subjectLabel(t: Pick<SalesTarget, "scope" | "userId" | "territoryId">) {
  if (t.scope === "COMPANY") return "Whole company";
  if (t.scope === "TERRITORY") {
    const terr = t.territoryId ? await prisma.salesTerritory.findUnique({ where: { id: t.territoryId }, select: { name: true, code: true } }) : null;
    return terr ? `${terr.name} (${terr.code})` : "Territory removed";
  }
  const u = t.userId ? await prisma.user.findUnique({ where: { id: t.userId }, select: { fullName: true } }) : null;
  return t.scope === "TEAM" ? `${u?.fullName ?? "—"}'s team` : (u?.fullName ?? "—");
}

// ── Create / edit ────────────────────────────────────────────────

export async function createTarget(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_performance", "create");
  const input = targetCreateSchema.parse(raw);
  const company = await fiscalStartMonth(actor.companyId);
  const scopeKey = input.scope as SalesTargetScopeKey;
  const periodType = input.periodType as SalesTargetPeriodTypeKey;
  if (!isPeriodStart(periodType, input.periodStart, company.fiscalYearStartMonth)) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Pick a period from the list.", { fieldErrors: { periodStart: "Not the start of a period." } });
  }
  const period = periodContaining(periodType, input.periodStart, company.fiscalYearStartMonth);
  if (period.end < todayIsoDate()) throw new BusinessRuleError("VALIDATION_ERROR", "That period has already ended. Targets can only be set for current or future periods.", { fieldErrors: { periodStart: "Already ended." } });
  checkValue(input.metric, input.targetValue);

  let userId: string | null = null;
  let territoryId: string | null = null;
  if (scopeKey === "REP" || scopeKey === "TEAM") {
    if (!input.userId) throw new BusinessRuleError("VALIDATION_ERROR", scopeKey === "REP" ? "Choose the sales rep." : "Choose the team's manager.", { fieldErrors: { userId: "Required." } });
    await assertEligibleRep(actor, input.userId);
    userId = input.userId;
    if (scopeKey === "TEAM") {
      const members = await teamMemberIds(userId);
      if (members.length < 2) {
        throw new BusinessRuleError("VALIDATION_ERROR", "This person has nobody below them in the CRM reporting tree, so there is no team. Set a Rep target, or set up reporting lines first.", {
          fieldErrors: { userId: "No team." },
        });
      }
    }
  } else if (scopeKey === "TERRITORY") {
    if (!input.territoryId) throw new BusinessRuleError("VALIDATION_ERROR", "Choose the territory.", { fieldErrors: { territoryId: "Required." } });
    const terr = await prisma.salesTerritory.findFirst({ where: { id: input.territoryId, companyId: actor.companyId, isActive: true } });
    if (!terr) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active territory.", { fieldErrors: { territoryId: "Not an active territory." } });
    territoryId = terr.id;
  }

  const scope = await getPerformanceScope(actor);
  if (!canSeeTarget(scope, { scope: scopeKey, userId, territoryId })) {
    throw new BusinessRuleError("PERMISSION_DENIED", "You can only set targets for yourself, your team or territories you cover.");
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const t = await tx.salesTarget.create({
        data: {
          companyId: actor.companyId,
          scope: scopeKey,
          userId,
          territoryId,
          metric: input.metric,
          periodType,
          periodStart: toDbDate(period.start),
          periodEnd: toDbDate(period.end),
          currencyCode: company.baseCurrencyCode,
          name: blank(input.name),
          createdByUserId: actor.userId,
          revisions: { create: { revisionNumber: 1, targetValue: input.targetValue, notes: blank(input.notes), createdByUserId: actor.userId, updatedByUserId: actor.userId } },
        },
      });
      await recordPerformanceEvent(tx, actor, "TARGET", t.id, "TARGET_CREATED", null, { value: input.targetValue, period: period.label });
      await auditPerformance(tx, actor, TABLE, t.id, "CREATE", null, { scope: scopeKey, userId, territoryId, metric: input.metric, periodType, periodStart: period.start, targetValue: input.targetValue });
      return t;
    });
    return getTarget(actor, created.id);
  } catch (error) {
    uniqueViolation(error);
  }
}

export async function saveDraftRevision(actor: SalesActor, targetId: string, revisionId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_performance", "edit");
  const input = revisionSaveSchema.parse(raw);
  const { target, revision } = await loadRevision(actor, targetId, revisionId);
  requireStatus(revision, ["DRAFT"], "edited");
  requireOpenPeriod(target, "changed");
  if (revision.version !== input.version) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone else saved this revision after you opened it. Reload to see their changes.");
  checkValue(target.metric, input.targetValue);
  await prisma.$transaction(async (tx) => {
    await guardedMove(tx, revision, { targetValue: input.targetValue, notes: blank(input.notes), updatedByUserId: actor.userId });
    await recordPerformanceEvent(tx, actor, "TARGET", target.id, "REVISION_SAVED", null, { revision: revision.revisionNumber, value: input.targetValue });
    await auditPerformance(tx, actor, "sales_target_revisions", revision.id, "UPDATE", { targetValue: Number(revision.targetValue), notes: revision.notes }, { targetValue: input.targetValue, notes: blank(input.notes) });
  });
  return getTarget(actor, targetId);
}

/** Starts a new draft revision copied from the latest one (an approved target is changed this way). */
export async function startNewRevision(actor: SalesActor, targetId: string) {
  await PermissionService.assert(actor.userId, "sales_performance", "edit");
  const target = await loadTarget(actor, targetId);
  requireOpenPeriod(target, "changed");
  const latest = await prisma.salesTargetRevision.findFirst({ where: { targetId: target.id }, orderBy: { revisionNumber: "desc" } });
  if (!latest) throw new BusinessRuleError("NOT_FOUND", "Revision not found.");
  if (latest.status === "DRAFT" || latest.status === "PENDING_APPROVAL") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This target already has a draft or pending revision.");
  const next = latest.revisionNumber + 1;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.salesTargetRevision.create({ data: { targetId: target.id, revisionNumber: next, targetValue: latest.targetValue, notes: latest.notes, createdByUserId: actor.userId, updatedByUserId: actor.userId } });
      await recordPerformanceEvent(tx, actor, "TARGET", target.id, "REVISION_STARTED", null, { revision: next });
      await auditPerformance(tx, actor, TABLE, target.id, "UPDATE", null, { newRevision: next });
    });
  } catch (error) {
    uniqueViolation(error);
  }
  return getTarget(actor, targetId);
}

// ── Revision lifecycle ───────────────────────────────────────────

export async function revisionAction(actor: SalesActor, targetId: string, revisionId: string, action: string, raw: unknown) {
  const { target, revision } = await loadRevision(actor, targetId, revisionId);
  if (target.isArchived) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This target is archived; its revisions can't change.");
  const subject = await subjectLabel(target);
  const label = `${subject} · ${metricDefinition(target.metric).label} · ${periodLabel(target.periodType, dbDate(target.periodStart), (await fiscalStartMonth(actor.companyId)).fiscalYearStartMonth)}`;
  switch (action) {
    case "submit": {
      await PermissionService.assert(actor.userId, "sales_performance", "edit");
      const { comment } = commentSchema.parse(raw ?? {});
      requireStatus(revision, ["DRAFT"], "submitted");
      requireOpenPeriod(target, "submitted");
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, revision, { status: "PENDING_APPROVAL", submittedByUserId: actor.userId, submittedAt: new Date(), decisionComment: null });
        await recordPerformanceEvent(tx, actor, "TARGET", target.id, "SUBMITTED", comment || null, { revision: revision.revisionNumber, value: Number(revision.targetValue) });
        await auditPerformance(tx, actor, TABLE, target.id, "UPDATE", { status: revision.status }, { status: "PENDING_APPROVAL", revision: revision.revisionNumber });
        await notifyApprovers(tx, actor, [actor.userId, revision.createdByUserId, revision.updatedByUserId], "Sales target waits for approval", label);
      });
      break;
    }
    case "return-to-draft": {
      await PermissionService.assert(actor.userId, "sales_performance", "edit");
      const { comment } = commentSchema.parse(raw ?? {});
      requireStatus(revision, ["PENDING_APPROVAL"], "returned to draft");
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, revision, { status: "DRAFT", submittedByUserId: null, submittedAt: null });
        await recordPerformanceEvent(tx, actor, "TARGET", target.id, "RETURNED_TO_DRAFT", comment || null, { revision: revision.revisionNumber });
        await auditPerformance(tx, actor, TABLE, target.id, "UPDATE", { status: revision.status }, { status: "DRAFT", revision: revision.revisionNumber });
      });
      break;
    }
    case "send-back": {
      await PermissionService.assert(actor.userId, "sales_performance", "reject");
      const { reason } = reasonSchema.parse(raw ?? {});
      requireStatus(revision, ["PENDING_APPROVAL"], "sent back");
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, revision, { status: "DRAFT", decisionComment: reason, submittedByUserId: null, submittedAt: null });
        await recordPerformanceEvent(tx, actor, "TARGET", target.id, "SENT_BACK", reason, { revision: revision.revisionNumber });
        await auditPerformance(tx, actor, TABLE, target.id, "REJECT", { status: revision.status }, { status: "DRAFT", revision: revision.revisionNumber, reason });
        for (const userId of new Set([revision.createdByUserId, revision.submittedByUserId].filter((u): u is string => Boolean(u) && u !== actor.userId))) {
          await createNotification({ companyId: actor.companyId, userId, title: "Sales target sent back", body: `${label}: ${reason}` }, tx);
        }
      });
      break;
    }
    case "approve": {
      await PermissionService.assert(actor.userId, "sales_performance", "approve");
      const { comment } = commentSchema.parse(raw ?? {});
      requireStatus(revision, ["PENDING_APPROVAL"], "approved");
      requireOpenPeriod(target, "approved");
      if (!(await canApproveTarget(actor.userId, [revision.createdByUserId, revision.updatedByUserId, revision.submittedByUserId]))) {
        throw new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "Someone other than the person who prepared or submitted this revision must approve it.");
      }
      try {
        await prisma.$transaction(async (tx) => {
          const now = new Date();
          const previous = await tx.salesTargetRevision.findFirst({ where: { targetId: target.id, status: "APPROVED" } });
          if (previous) await tx.salesTargetRevision.update({ where: { id: previous.id }, data: { status: "SUPERSEDED", supersededAt: now, version: { increment: 1 } } });
          await guardedMove(tx, revision, { status: "APPROVED", approvedByUserId: actor.userId, approvedAt: now, decisionComment: comment || null });
          const afterStart = todayIsoDate() > dbDate(target.periodStart);
          await recordPerformanceEvent(tx, actor, "TARGET", target.id, "APPROVED", comment || null, {
            revision: revision.revisionNumber,
            value: Number(revision.targetValue),
            previousValue: previous ? Number(previous.targetValue) : null,
            approvedAfterPeriodStart: afterStart,
          });
          await auditPerformance(tx, actor, TABLE, target.id, "APPROVE", { status: revision.status, previousValue: previous ? Number(previous.targetValue) : null }, { status: "APPROVED", revision: revision.revisionNumber, value: Number(revision.targetValue) });
          for (const userId of new Set([revision.createdByUserId, revision.submittedByUserId, target.scope === "REP" ? target.userId : null].filter((u): u is string => Boolean(u) && u !== actor.userId))) {
            await createNotification({ companyId: actor.companyId, userId, title: "Sales target approved", body: label }, tx);
          }
        });
      } catch (error) {
        uniqueViolation(error);
      }
      break;
    }
    case "discard": {
      await PermissionService.assert(actor.userId, "sales_performance", "edit");
      requireStatus(revision, ["DRAFT"], "discarded");
      const others = await prisma.salesTargetRevision.count({ where: { targetId: target.id, id: { not: revision.id } } });
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.salesTargetRevision.deleteMany({ where: { id: revision.id, status: "DRAFT", version: revision.version } });
        if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This revision changed just now. Reload and try again.");
        if (!others) {
          // A target that never had another revision goes away with its only draft.
          await tx.salesPerformanceEvent.deleteMany({ where: { entityType: "TARGET", entityId: target.id } });
          await tx.salesTarget.delete({ where: { id: target.id } });
          await auditPerformance(tx, actor, TABLE, target.id, "DELETE", { scope: target.scope, metric: target.metric, periodStart: dbDate(target.periodStart) }, null);
        } else {
          await recordPerformanceEvent(tx, actor, "TARGET", target.id, "DISCARDED", null, { revision: revision.revisionNumber });
          await auditPerformance(tx, actor, TABLE, target.id, "UPDATE", { revision: revision.revisionNumber }, { discarded: true });
        }
      });
      if (!others) return { id: target.id, deleted: true as const };
      break;
    }
    default:
      throw new BusinessRuleError("NOT_FOUND", "Unknown revision action.", { action });
  }
  return getTarget(actor, targetId);
}

export async function archiveTarget(actor: SalesActor, targetId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_performance", "edit");
  const { reason } = reasonSchema.parse(raw ?? {});
  const target = await loadTarget(actor, targetId);
  if (target.isArchived) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This target is already archived.");
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.salesTarget.updateMany({ where: { id: target.id, companyId: actor.companyId, isArchived: false }, data: { isArchived: true, archivedAt: new Date(), archivedByUserId: actor.userId, archiveReason: reason } });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This target changed just now. Reload and try again.");
    await recordPerformanceEvent(tx, actor, "TARGET", target.id, "ARCHIVED", reason);
    await auditPerformance(tx, actor, TABLE, target.id, "UPDATE", { isArchived: false }, { isArchived: true, reason });
  });
  return getTarget(actor, targetId);
}

// ── Actuals for targets ──────────────────────────────────────────

type TotalsCache = Map<string, Promise<MetricTotals>>;

function cachedTotals(cache: TotalsCache, companyId: string, metric: SalesTargetMetricKey, from: string, to: string, grouping: "REP" | "TERRITORY" | "TOTAL") {
  const key = `${metric}|${from}|${to}|${grouping}`;
  let p = cache.get(key);
  if (!p) {
    p = metricTotals(companyId, metric, from, to, grouping);
    cache.set(key, p);
  }
  return p;
}

/** Actual value for one target, from the shared metric service. */
export async function targetActual(companyId: string, t: Pick<SalesTarget, "scope" | "userId" | "territoryId" | "metric" | "periodStart" | "periodEnd">, cache: TotalsCache = new Map()) {
  const from = dbDate(t.periodStart);
  const to = dbDate(t.periodEnd);
  if (t.scope === "REP") return sumKeys(await cachedTotals(cache, companyId, t.metric, from, to, "REP"), t.userId ? [t.userId] : []);
  if (t.scope === "TEAM") return sumKeys(await cachedTotals(cache, companyId, t.metric, from, to, "REP"), t.userId ? await teamMemberIds(t.userId) : []);
  if (t.scope === "TERRITORY") return sumKeys(await cachedTotals(cache, companyId, t.metric, from, to, "TERRITORY"), t.territoryId ? [t.territoryId] : []);
  return sumKeys(await cachedTotals(cache, companyId, t.metric, from, to, "TOTAL"), ["TOTAL"]);
}

// ── Read ─────────────────────────────────────────────────────────

export const targetFilterSchema = z.object({
  periodType: periodEnum.optional().or(z.literal("")),
  periodStart: isoDateSchema.optional().or(z.literal("")),
  scope: scopeEnum.optional().or(z.literal("")),
  metric: metricEnum.optional().or(z.literal("")),
  status: z.enum(["live", "approved", "pending", "draft", "archived", "all"]).optional().or(z.literal("")),
  userId: z.string().uuid().optional().or(z.literal("")),
  territoryId: z.string().uuid().optional().or(z.literal("")),
});

const MAX_LIST = 500;

export async function listTargets(actor: SalesActor, raw: unknown) {
  const f = targetFilterSchema.parse(raw ?? {});
  const company = await fiscalStartMonth(actor.companyId);
  const scope = await getPerformanceScope(actor);
  const and: Prisma.SalesTargetWhereInput[] = [{ companyId: actor.companyId }];
  if (f.periodType) and.push({ periodType: f.periodType });
  if (f.periodStart) and.push({ periodStart: toDbDate(f.periodStart) });
  if (f.scope) and.push({ scope: f.scope });
  if (f.metric) and.push({ metric: f.metric });
  if (f.userId) and.push({ userId: f.userId });
  if (f.territoryId) and.push({ territoryId: f.territoryId });
  const status = f.status || "live";
  if (status === "archived") and.push({ isArchived: true });
  else if (status !== "all") and.push({ isArchived: false });
  if (status === "approved") and.push({ revisions: { some: { status: "APPROVED" } } });
  if (status === "pending") and.push({ revisions: { some: { status: "PENDING_APPROVAL" } } });
  if (status === "draft") and.push({ revisions: { none: { status: "APPROVED" } }, AND: [{ revisions: { some: { status: "DRAFT" } } }] });

  const rows = await prisma.salesTarget.findMany({
    where: { AND: and },
    orderBy: [{ periodStart: "desc" }, { scope: "asc" }, { metric: "asc" }],
    take: MAX_LIST + 1,
    include: {
      user: { select: { fullName: true } },
      territory: { select: { name: true, code: true } },
      revisions: { where: { status: { in: ["APPROVED", "DRAFT", "PENDING_APPROVAL"] } }, select: { id: true, status: true, targetValue: true, revisionNumber: true } },
    },
  });
  const visible = rows.filter((t) => canSeeTarget(scope, t));
  const truncated = visible.length > MAX_LIST;
  const today = todayIsoDate();
  const cache: TotalsCache = new Map();
  const data = await Promise.all(
    visible.slice(0, MAX_LIST).map(async (t) => {
      const approved = t.revisions.find((r) => r.status === "APPROVED");
      const open = t.revisions.find((r) => r.status !== "APPROVED");
      const start = dbDate(t.periodStart);
      const end = dbDate(t.periodEnd);
      const actual = await targetActual(actor.companyId, t, cache);
      const progress = periodProgress(start, end, today);
      const def = metricDefinition(t.metric);
      return {
        id: t.id,
        scope: t.scope,
        scopeLabel: SCOPE_LABELS[t.scope],
        subject:
          t.scope === "COMPANY"
            ? "Whole company"
            : t.scope === "TERRITORY"
              ? `${t.territory?.name ?? "—"} (${t.territory?.code ?? ""})`
              : t.scope === "TEAM"
                ? `${t.user?.fullName ?? "—"}'s team`
                : (t.user?.fullName ?? "—"),
        metric: t.metric,
        metricLabel: def.label,
        unit: def.unit,
        periodType: t.periodType,
        periodLabel: periodLabel(t.periodType, start, company.fiscalYearStartMonth),
        periodStart: start,
        periodEnd: end,
        archived: t.isArchived,
        status: approved ? "APPROVED" : (open?.status ?? "DRAFT"),
        openRevisionStatus: approved && open ? open.status : null,
        ...attainment(approved ? Number(approved.targetValue) : null, actual.value, progress),
        documents: actual.documents,
        progress,
      };
    })
  );
  return { data, truncated, calculatedAt: new Date().toISOString() };
}

export async function getTarget(actor: SalesActor, id: string) {
  const t = await loadTarget(actor, id);
  const company = await fiscalStartMonth(actor.companyId);
  const revisions = await prisma.salesTargetRevision.findMany({
    where: { targetId: t.id },
    orderBy: { revisionNumber: "desc" },
    include: {
      createdBy: { select: { fullName: true } },
      updatedBy: { select: { fullName: true } },
      submittedBy: { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
    },
  });
  const start = dbDate(t.periodStart);
  const end = dbDate(t.periodEnd);
  const today = todayIsoDate();
  const approved = revisions.find((r) => r.status === "APPROVED");
  const open = revisions.find((r) => r.status === "DRAFT" || r.status === "PENDING_APPROVAL");
  const [actual, events, subject, archivedBy] = await Promise.all([
    targetActual(actor.companyId, t),
    listPerformanceEvents(prisma, actor.companyId, "TARGET", t.id),
    subjectLabel(t),
    t.archivedByUserId ? prisma.user.findUnique({ where: { id: t.archivedByUserId }, select: { fullName: true } }) : null,
  ]);
  const canApprove = open?.status === "PENDING_APPROVAL" ? await canApproveTarget(actor.userId, [open.createdByUserId, open.updatedByUserId, open.submittedByUserId]) : false;
  const def = metricDefinition(t.metric);
  const progress = periodProgress(start, end, today);
  return {
    id: t.id,
    scope: t.scope,
    scopeLabel: SCOPE_LABELS[t.scope],
    userId: t.userId,
    territoryId: t.territoryId,
    subject,
    name: t.name,
    metric: t.metric,
    metricLabel: def.label,
    metricDefinition: def.definition,
    dateBasis: def.dateBasis,
    unit: def.unit,
    source: def.source,
    periodType: t.periodType,
    periodLabel: periodLabel(t.periodType, start, company.fiscalYearStartMonth),
    periodStart: start,
    periodEnd: end,
    currencyCode: t.currencyCode,
    archived: t.isArchived,
    archivedAt: t.archivedAt?.toISOString() ?? null,
    archivedBy: archivedBy?.fullName ?? null,
    archiveReason: t.archiveReason,
    periodEnded: end < today,
    progress,
    attainment: attainment(approved ? Number(approved.targetValue) : null, actual.value, progress),
    documents: actual.documents,
    calculatedAt: new Date().toISOString(),
    canApprove,
    revisions: revisions.map((r) => ({
      id: r.id,
      revisionNumber: r.revisionNumber,
      status: r.status,
      targetValue: Number(r.targetValue),
      notes: r.notes,
      version: r.version,
      createdBy: r.createdBy.fullName,
      createdAt: r.createdAt.toISOString(),
      updatedBy: r.updatedBy.fullName,
      updatedAt: r.updatedAt.toISOString(),
      submittedBy: r.submittedBy?.fullName ?? null,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      approvedBy: r.approvedBy?.fullName ?? null,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      approvedAfterPeriodStart: r.approvedAt ? r.approvedAt.toISOString().slice(0, 10) > start : false,
      decisionComment: r.decisionComment,
      supersededAt: r.supersededAt?.toISOString() ?? null,
    })),
    events,
  };
}
