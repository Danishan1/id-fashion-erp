import { Prisma, type SalesIncentivePlan } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { dbDate, isoDateSchema, optionalText, toDbDate } from "@/modules/sales-marketing/performance/performance-common";
import { METRIC_KEYS, metricDefinition } from "@/modules/sales-marketing/performance/performance-registry";
import { assertEligibleRep } from "@/modules/sales-marketing/performance/territory.service";
import { canApproveCommission, notifyCommissionApprovers } from "./commission-plan.service";
import { incentiveTierProblems, type IncentiveTier } from "./commission-engine";

/**
 * Incentive plans (Phase 07, PHASE_07_COMMISSIONS.md §5): target-attainment
 * bonus tiers on Phase 05 REP targets. Draft → Pending approval → Approved →
 * Retired; approver ≠ preparer; an approved plan is never edited.
 */

const TABLE = "sales_incentive_plans";

const tierSchema = z.object({ attainment: z.coerce.number(), reward: z.coerce.number() }).strict();
const fields = {
  name: z.string().trim().min(1, "Enter a name").max(200),
  description: optionalText(1000),
  metric: z.enum(METRIC_KEYS),
  periodType: z.enum(["MONTH", "QUARTER", "YEAR"]),
  effectiveFrom: isoDateSchema,
  effectiveTo: isoDateSchema.optional().or(z.literal("")).nullable(),
  tiers: z.array(tierSchema).max(10),
  userIds: z.array(z.string().uuid()).max(500).default([]),
};
export const incentiveCreateSchema = z
  .object({ code: z.string().trim().min(1, "Enter a code").max(40).regex(/^[A-Za-z0-9._-]+$/, "Letters, digits, . _ - only"), ...fields })
  .strict();
export const incentiveSaveSchema = z.object({ ...fields, version: z.number().int().min(1) }).strict();
const commentSchema = z.object({ comment: optionalText(1000) }).strict();
const reasonSchema = z.object({ reason: z.string().trim().min(3, "Say why").max(1000) }).strict();

async function columns(actor: SalesActor, input: z.infer<typeof incentiveSaveSchema> | z.infer<typeof incentiveCreateSchema>) {
  const effectiveTo = input.effectiveTo || null;
  if (effectiveTo && effectiveTo < input.effectiveFrom) throw new BusinessRuleError("VALIDATION_ERROR", "The end date is before the start date.", { fieldErrors: { effectiveTo: "Before the start date." } });
  const tiers = input.tiers.map((t) => ({ attainment: Math.round(t.attainment * 100) / 100, reward: Math.round(t.reward * 100) / 100 }));
  const problems = incentiveTierProblems(tiers);
  if (problems.length) throw new BusinessRuleError("VALIDATION_ERROR", problems.join(" "), { fieldErrors: { tiers: problems[0] } });
  const userIds = [...new Set(input.userIds)];
  for (const id of userIds) await assertEligibleRep(actor, id, "userIds");
  return {
    name: input.name,
    description: input.description || null,
    metric: input.metric,
    periodType: input.periodType,
    effectiveFrom: toDbDate(input.effectiveFrom),
    effectiveTo: effectiveTo ? toDbDate(effectiveTo) : null,
    tiers: tiers as unknown as Prisma.InputJsonValue,
    userIds,
  };
}

async function audit(tx: Prisma.TransactionClient, actor: SalesActor, id: string, action: "CREATE" | "UPDATE" | "APPROVE" | "REJECT" | "DELETE", oldValues: unknown, newValues: unknown) {
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: id, action, oldValues: oldValues as Record<string, unknown>, newValues: newValues as Record<string, unknown> }, tx);
}

async function load(actor: SalesActor, id: string) {
  const p = await prisma.salesIncentivePlan.findFirst({ where: { id, companyId: actor.companyId } });
  if (!p) throw new BusinessRuleError("NOT_FOUND", "Incentive plan not found.", { id });
  return p;
}

export async function createIncentivePlan(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_commissions", "edit");
  const input = incentiveCreateSchema.parse(raw);
  const data = await columns(actor, input);
  try {
    const p = await prisma.$transaction(async (tx) => {
      const created = await tx.salesIncentivePlan.create({ data: { companyId: actor.companyId, code: input.code.toUpperCase(), ...data, createdByUserId: actor.userId, updatedByUserId: actor.userId } });
      await audit(tx, actor, created.id, "CREATE", null, { code: created.code, metric: data.metric, periodType: data.periodType, tiers: data.tiers });
      return created;
    });
    return getIncentivePlan(actor, p.id);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new BusinessRuleError("VALIDATION_ERROR", "An incentive plan with this code already exists.", { fieldErrors: { code: "Already used." } });
    throw error;
  }
}

export async function updateIncentivePlan(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_commissions", "edit");
  const input = incentiveSaveSchema.parse(raw);
  const p = await load(actor, id);
  if (p.status !== "DRAFT") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a draft incentive plan can be edited. Retire an approved plan and make a new one.");
  if (p.version !== input.version) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone else saved this plan after you opened it. Reload to see their changes.");
  const data = await columns(actor, input);
  await prisma.$transaction(async (tx) => {
    await guardedMove(tx, { ...p, companyId: actor.companyId }, { ...data, updatedByUserId: actor.userId });
    await audit(tx, actor, id, "UPDATE", { tiers: p.tiers, metric: p.metric }, { tiers: data.tiers, metric: data.metric });
  });
  return getIncentivePlan(actor, id);
}

async function guardedMove(tx: Prisma.TransactionClient, p: SalesIncentivePlan, data: Prisma.SalesIncentivePlanUncheckedUpdateManyInput) {
  const { count } = await tx.salesIncentivePlan.updateMany({ where: { id: p.id, companyId: p.companyId, status: p.status, version: p.version }, data: { ...data, version: { increment: 1 } } });
  if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This incentive plan changed just now. Reload and try again.");
}

export async function incentivePlanAction(actor: SalesActor, id: string, action: string, raw: unknown) {
  const p = await load(actor, id);
  const need = (statuses: string[], verb: string) => {
    if (!statuses.includes(p.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `A ${p.status.toLowerCase().replace(/_/g, " ")} incentive plan can't be ${verb}.`);
  };
  switch (action) {
    case "submit": {
      await PermissionService.assert(actor.userId, "sales_commissions", "edit");
      commentSchema.parse(raw ?? {});
      need(["DRAFT"], "submitted");
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, p, { status: "PENDING_APPROVAL", submittedByUserId: actor.userId, submittedAt: new Date(), decisionComment: null });
        await audit(tx, actor, id, "UPDATE", { status: p.status }, { status: "PENDING_APPROVAL" });
        await notifyCommissionApprovers(tx, actor, [actor.userId, p.createdByUserId, p.updatedByUserId], `Incentive plan ${p.code} waits for approval`, p.name);
      });
      break;
    }
    case "return-to-draft": {
      await PermissionService.assert(actor.userId, "sales_commissions", "edit");
      need(["PENDING_APPROVAL"], "returned to draft");
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, p, { status: "DRAFT", submittedByUserId: null, submittedAt: null });
        await audit(tx, actor, id, "UPDATE", { status: p.status }, { status: "DRAFT" });
      });
      break;
    }
    case "send-back": {
      await PermissionService.assert(actor.userId, "sales_commissions", "reject");
      const { reason } = reasonSchema.parse(raw ?? {});
      need(["PENDING_APPROVAL"], "sent back");
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, p, { status: "DRAFT", decisionComment: reason, submittedByUserId: null, submittedAt: null });
        await audit(tx, actor, id, "REJECT", { status: p.status }, { status: "DRAFT", reason });
      });
      break;
    }
    case "approve": {
      await PermissionService.assert(actor.userId, "sales_commissions", "approve");
      const { comment } = commentSchema.parse(raw ?? {});
      need(["PENDING_APPROVAL"], "approved");
      if (!(await canApproveCommission(actor.userId, [p.createdByUserId, p.updatedByUserId, p.submittedByUserId]))) {
        throw new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "Someone other than the person who prepared or submitted this plan must approve it.");
      }
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, p, { status: "APPROVED", approvedByUserId: actor.userId, approvedAt: new Date(), decisionComment: comment || null });
        await audit(tx, actor, id, "APPROVE", { status: p.status }, { status: "APPROVED" });
        for (const userId of new Set([p.createdByUserId, p.submittedByUserId].filter((u): u is string => Boolean(u) && u !== actor.userId))) {
          await createNotification({ companyId: actor.companyId, userId, title: `Incentive plan ${p.code} approved`, body: `In force from ${dbDate(p.effectiveFrom)}.` }, tx);
        }
      });
      break;
    }
    case "retire": {
      await PermissionService.assert(actor.userId, "sales_commissions", "edit");
      const { reason } = reasonSchema.parse(raw ?? {});
      need(["APPROVED"], "retired");
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, p, { status: "RETIRED", retiredAt: new Date() });
        await audit(tx, actor, id, "UPDATE", { status: p.status }, { status: "RETIRED", reason });
      });
      break;
    }
    case "discard": {
      await PermissionService.assert(actor.userId, "sales_commissions", "edit");
      need(["DRAFT"], "discarded");
      if (p.approvedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This plan was approved before; retire it instead.");
      await prisma.$transaction(async (tx) => {
        await tx.salesIncentivePlan.deleteMany({ where: { id: p.id, status: "DRAFT" } });
        await audit(tx, actor, id, "DELETE", { code: p.code }, null);
      });
      return { id, deleted: true as const };
    }
    default:
      throw new BusinessRuleError("NOT_FOUND", "Unknown action.", { action });
  }
  return getIncentivePlan(actor, id);
}

export function incentiveTiersOf(p: Pick<SalesIncentivePlan, "tiers">): IncentiveTier[] {
  return (p.tiers as unknown as IncentiveTier[]) ?? [];
}

export async function listIncentivePlans(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_commissions", "view");
  const f = z.object({ status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "RETIRED"]).optional().or(z.literal("")) }).parse(raw ?? {});
  const rows = await prisma.salesIncentivePlan.findMany({ where: { companyId: actor.companyId, ...(f.status ? { status: f.status } : {}) }, orderBy: [{ status: "asc" }, { code: "asc" }] });
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    metric: p.metric,
    metricLabel: metricDefinition(p.metric).label,
    periodType: p.periodType,
    effectiveFrom: dbDate(p.effectiveFrom),
    effectiveTo: p.effectiveTo ? dbDate(p.effectiveTo) : null,
    status: p.status,
    tiers: incentiveTiersOf(p),
    reps: p.userIds.length,
  }));
}

export async function getIncentivePlan(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "sales_commissions", "view");
  const p = await prisma.salesIncentivePlan.findFirst({
    where: { id, companyId: actor.companyId },
    include: { createdBy: { select: { fullName: true } }, submittedBy: { select: { fullName: true } }, approvedBy: { select: { fullName: true } } },
  });
  if (!p) throw new BusinessRuleError("NOT_FOUND", "Incentive plan not found.", { id });
  const users = p.userIds.length ? await prisma.user.findMany({ where: { id: { in: p.userIds }, companyId: actor.companyId }, select: { id: true, fullName: true } }) : [];
  const awarded = await prisma.salesCommissionLine.count({ where: { companyId: actor.companyId, incentivePlanId: p.id } });
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    metric: p.metric,
    metricLabel: metricDefinition(p.metric).label,
    periodType: p.periodType,
    effectiveFrom: dbDate(p.effectiveFrom),
    effectiveTo: p.effectiveTo ? dbDate(p.effectiveTo) : null,
    tiers: incentiveTiersOf(p),
    users: users.map((u) => ({ id: u.id, label: u.fullName })),
    status: p.status,
    version: p.version,
    createdBy: p.createdBy.fullName,
    submittedBy: p.submittedBy?.fullName ?? null,
    approvedBy: p.approvedBy?.fullName ?? null,
    approvedAt: p.approvedAt?.toISOString() ?? null,
    decisionComment: p.decisionComment,
    awardedLines: awarded,
    viewerCanApprove: p.status === "PENDING_APPROVAL" ? await canApproveCommission(actor.userId, [p.createdByUserId, p.updatedByUserId, p.submittedByUserId]) : false,
  };
}
