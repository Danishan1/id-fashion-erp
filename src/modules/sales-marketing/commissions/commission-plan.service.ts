import { Prisma, type SalesCommissionPlanVersion } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { todayIsoDate } from "@/lib/date";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { dbDate, isoDateSchema, optionalText, toDbDate } from "@/modules/sales-marketing/performance/performance-common";
import { assertEligibleRep } from "@/modules/sales-marketing/performance/territory.service";
import { tierProblems, type CommissionRule, type CommissionTier } from "./commission-engine";

/**
 * Commission plans (Phase 07, PHASE_07_COMMISSIONS.md §3): header + numbered
 * versions (Draft → Pending approval → Approved, approver ≠ preparer; only a
 * Draft is edited) + effective-dated assignments (one in force per payee).
 */

const TABLE = "sales_commission_plans";
const r2 = (v: number) => Math.round(v * 100) / 100;
const money = (max = 9_999_999_999.99) => z.coerce.number().min(0, "Can't be negative").max(max);
const optMoney = z.union([z.literal(""), z.null(), money()]).optional();
const num = (v: number | string | "" | null | undefined) => (v === "" || v === null || v === undefined ? null : Number(v));

export const tierSchema = z.object({ from: z.coerce.number().min(0), rate: z.coerce.number().min(0).max(100) }).strict();
const ruleFields = {
  effectiveFrom: isoDateSchema,
  effectiveTo: isoDateSchema.optional().or(z.literal("")).nullable(),
  method: z.enum(["PERCENT", "FIXED"]),
  tierMode: z.enum(["ALL_UNITS", "PROGRESSIVE"]).default("ALL_UNITS"),
  tiers: z.array(tierSchema).max(10).default([]),
  fixedAmount: optMoney,
  minimumBasis: optMoney,
  capAmount: optMoney,
  notes: optionalText(2000),
};
export const planCreateSchema = z
  .object({
    code: z.string().trim().min(1, "Enter a code").max(40).regex(/^[A-Za-z0-9._-]+$/, "Letters, digits, . _ - only"),
    name: z.string().trim().min(1, "Enter a name").max(200),
    description: optionalText(1000),
    payeeType: z.enum(["REP", "AGENT"]),
    basis: z.enum(["INVOICED", "COLLECTED"]),
    ...ruleFields,
  })
  .strict();
export const planHeaderSchema = z.object({ name: z.string().trim().min(1).max(200), description: optionalText(1000) }).strict();
export const versionSaveSchema = z.object({ ...ruleFields, version: z.number().int().min(1) }).strict();
export const assignmentSchema = z
  .object({
    userId: z.string().uuid().optional().or(z.literal("")).nullable(),
    salesAgentId: z.string().uuid().optional().or(z.literal("")).nullable(),
    startDate: isoDateSchema,
    endDate: isoDateSchema.optional().or(z.literal("")).nullable(),
  })
  .strict();
const commentSchema = z.object({ comment: optionalText(1000) }).strict();
const reasonSchema = z.object({ reason: z.string().trim().min(3, "Say why").max(1000) }).strict();

type RuleInput = z.infer<typeof versionSaveSchema> | z.infer<typeof planCreateSchema>;

/** Validates a version's rule for a plan basis; returns the columns to store. */
function ruleColumns(input: RuleInput, basis: "INVOICED" | "COLLECTED") {
  const effectiveTo = input.effectiveTo || null;
  if (effectiveTo && effectiveTo < input.effectiveFrom) throw new BusinessRuleError("VALIDATION_ERROR", "The end date is before the start date.", { fieldErrors: { effectiveTo: "Before the start date." } });
  const fixedAmount = num(input.fixedAmount);
  if (input.method === "FIXED") {
    if (basis !== "INVOICED") throw new BusinessRuleError("VALIDATION_ERROR", "A fixed amount per invoice only works on the invoiced basis.", { fieldErrors: { method: "Use a percentage for collected value." } });
    if (fixedAmount === null || fixedAmount <= 0) throw new BusinessRuleError("VALIDATION_ERROR", "Enter the fixed amount per invoice.", { fieldErrors: { fixedAmount: "Required." } });
  } else {
    const problems = tierProblems(input.tiers);
    if (problems.length) throw new BusinessRuleError("VALIDATION_ERROR", problems.join(" "), { fieldErrors: { tiers: problems[0] } });
  }
  return {
    effectiveFrom: toDbDate(input.effectiveFrom),
    effectiveTo: effectiveTo ? toDbDate(effectiveTo) : null,
    method: input.method,
    tierMode: input.method === "PERCENT" ? input.tierMode : ("ALL_UNITS" as const),
    tiers: (input.method === "PERCENT" ? input.tiers.map((t) => ({ from: r2(t.from), rate: t.rate })) : []) as Prisma.InputJsonValue,
    fixedAmount: input.method === "FIXED" ? fixedAmount : null,
    minimumBasis: num(input.minimumBasis),
    capAmount: num(input.capAmount),
    notes: input.notes || null,
  };
}

export function ruleOf(v: Pick<SalesCommissionPlanVersion, "method" | "tierMode" | "tiers" | "fixedAmount" | "minimumBasis" | "capAmount">): CommissionRule {
  return {
    method: v.method,
    tierMode: v.tierMode,
    tiers: (v.tiers as unknown as CommissionTier[]) ?? [],
    fixedAmount: v.fixedAmount === null ? null : Number(v.fixedAmount),
    minimumBasis: v.minimumBasis === null ? null : Number(v.minimumBasis),
    capAmount: v.capAmount === null ? null : Number(v.capAmount),
  };
}

function uniqueViolation(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const t = JSON.stringify(error.meta ?? {});
    if (t.includes("code")) throw new BusinessRuleError("VALIDATION_ERROR", "A plan with this code already exists.", { fieldErrors: { code: "Already used." } });
    if (t.includes("one_open")) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This plan already has a draft or pending version.");
    if (t.includes("approved_start")) throw new BusinessRuleError("VALIDATION_ERROR", "Another approved version of this plan starts on the same day.", { fieldErrors: { effectiveFrom: "Already used." } });
    throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This plan changed just now. Reload and try again.");
  }
  throw error;
}

async function audit(tx: Prisma.TransactionClient, actor: SalesActor, recordId: string, action: "CREATE" | "UPDATE" | "APPROVE" | "REJECT" | "DELETE", oldValues: unknown, newValues: unknown) {
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId, action, oldValues: oldValues as Record<string, unknown>, newValues: newValues as Record<string, unknown> }, tx);
}

async function loadPlan(actor: SalesActor, id: string) {
  const plan = await prisma.salesCommissionPlan.findFirst({ where: { id, companyId: actor.companyId } });
  if (!plan) throw new BusinessRuleError("NOT_FOUND", "Commission plan not found.", { id });
  return plan;
}

export async function createPlan(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_commissions", "edit");
  const input = planCreateSchema.parse(raw);
  const rule = ruleColumns(input, input.basis);
  try {
    const plan = await prisma.$transaction(async (tx) => {
      const p = await tx.salesCommissionPlan.create({
        data: {
          companyId: actor.companyId,
          code: input.code.toUpperCase(),
          name: input.name,
          description: input.description || null,
          payeeType: input.payeeType,
          basis: input.basis,
          createdByUserId: actor.userId,
          versions: { create: { versionNumber: 1, ...rule, createdByUserId: actor.userId, updatedByUserId: actor.userId } },
        },
      });
      await audit(tx, actor, p.id, "CREATE", null, { code: p.code, payeeType: p.payeeType, basis: p.basis, rule });
      return p;
    });
    return getPlan(actor, plan.id);
  } catch (error) {
    uniqueViolation(error);
  }
}

export async function updatePlanHeader(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_commissions", "edit");
  const input = planHeaderSchema.parse(raw);
  const plan = await loadPlan(actor, id);
  await prisma.$transaction(async (tx) => {
    await tx.salesCommissionPlan.updateMany({ where: { id, companyId: actor.companyId }, data: { name: input.name, description: input.description || null } });
    await audit(tx, actor, id, "UPDATE", { name: plan.name, description: plan.description }, input);
  });
  return getPlan(actor, id);
}

export async function setPlanActive(actor: SalesActor, id: string, isActive: boolean) {
  await PermissionService.assert(actor.userId, "sales_commissions", "edit");
  const plan = await loadPlan(actor, id);
  if (plan.isActive === isActive) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This plan is already ${isActive ? "active" : "inactive"}.`);
  await prisma.$transaction(async (tx) => {
    await tx.salesCommissionPlan.updateMany({ where: { id, companyId: actor.companyId }, data: { isActive } });
    await audit(tx, actor, id, "UPDATE", { isActive: plan.isActive }, { isActive });
  });
  return getPlan(actor, id);
}

async function loadVersion(actor: SalesActor, planId: string, versionId: string) {
  const plan = await loadPlan(actor, planId);
  const version = await prisma.salesCommissionPlanVersion.findFirst({ where: { id: versionId, planId: plan.id } });
  if (!version) throw new BusinessRuleError("NOT_FOUND", "Version not found.", { versionId });
  return { plan, version };
}

export async function saveDraftVersion(actor: SalesActor, planId: string, versionId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_commissions", "edit");
  const input = versionSaveSchema.parse(raw);
  const { plan, version } = await loadVersion(actor, planId, versionId);
  if (version.status !== "DRAFT") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a draft version can be edited. Start a new version to change the plan.");
  if (version.version !== input.version) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone else saved this version after you opened it. Reload to see their changes.");
  const rule = ruleColumns(input, plan.basis);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.salesCommissionPlanVersion.updateMany({ where: { id: version.id, status: "DRAFT", version: version.version }, data: { ...rule, updatedByUserId: actor.userId, version: { increment: 1 } } });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This version changed just now. Reload and try again.");
    await audit(tx, actor, plan.id, "UPDATE", { versionNumber: version.versionNumber }, { versionNumber: version.versionNumber, rule });
  });
  return getPlan(actor, planId);
}

/** New draft version, copied from the latest one. */
export async function startNewVersion(actor: SalesActor, planId: string) {
  await PermissionService.assert(actor.userId, "sales_commissions", "edit");
  const plan = await loadPlan(actor, planId);
  const latest = await prisma.salesCommissionPlanVersion.findFirst({ where: { planId: plan.id }, orderBy: { versionNumber: "desc" } });
  if (!latest) throw new BusinessRuleError("NOT_FOUND", "Version not found.");
  if (latest.status === "DRAFT" || latest.status === "PENDING_APPROVAL") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This plan already has a draft or pending version.");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.salesCommissionPlanVersion.create({
        data: {
          planId: plan.id,
          versionNumber: latest.versionNumber + 1,
          effectiveFrom: toDbDate(todayIsoDate() > dbDate(latest.effectiveFrom) ? todayIsoDate() : dbDate(latest.effectiveFrom)),
          effectiveTo: latest.effectiveTo,
          method: latest.method,
          tierMode: latest.tierMode,
          tiers: latest.tiers as Prisma.InputJsonValue,
          fixedAmount: latest.fixedAmount,
          minimumBasis: latest.minimumBasis,
          capAmount: latest.capAmount,
          notes: latest.notes,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
      });
      await audit(tx, actor, plan.id, "UPDATE", null, { newVersion: latest.versionNumber + 1 });
    });
  } catch (error) {
    uniqueViolation(error);
  }
  return getPlan(actor, planId);
}

export async function canApproveCommission(userId: string, involved: (string | null)[]) {
  const people = [...new Set(involved.filter((v): v is string => Boolean(v)))];
  if (!people.length) return PermissionService.can(userId, "sales_commissions", "approve");
  for (const createdBy of people) if (!(await PermissionService.can(userId, "sales_commissions", "approve", { createdBy }))) return false;
  return true;
}

export async function notifyCommissionApprovers(tx: Prisma.TransactionClient, actor: SalesActor, exclude: (string | null)[], title: string, body: string) {
  const users = await prisma.user.findMany({ where: { companyId: actor.companyId, status: "ACTIVE", supportForPlatformUserId: null }, select: { id: true } });
  const ok = await Promise.all(users.map((u) => PermissionService.can(u.id, "sales_commissions", "approve")));
  for (const u of users.filter((x, i) => ok[i] && !exclude.includes(x.id))) await createNotification({ companyId: actor.companyId, userId: u.id, title, body }, tx);
}

async function guardedMove(tx: Prisma.TransactionClient, v: SalesCommissionPlanVersion, data: Prisma.SalesCommissionPlanVersionUncheckedUpdateManyInput) {
  const { count } = await tx.salesCommissionPlanVersion.updateMany({ where: { id: v.id, status: v.status, version: v.version }, data: { ...data, version: { increment: 1 } } });
  if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This version changed just now. Reload and try again.");
}

export async function versionAction(actor: SalesActor, planId: string, versionId: string, action: string, raw: unknown) {
  const { plan, version } = await loadVersion(actor, planId, versionId);
  const label = `${plan.code} v${version.versionNumber}`;
  const need = (statuses: string[], verb: string) => {
    if (!statuses.includes(version.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `A ${version.status.toLowerCase().replace(/_/g, " ")} version can't be ${verb}.`);
  };
  switch (action) {
    case "submit": {
      await PermissionService.assert(actor.userId, "sales_commissions", "edit");
      const { comment } = commentSchema.parse(raw ?? {});
      need(["DRAFT"], "submitted");
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, version, { status: "PENDING_APPROVAL", submittedByUserId: actor.userId, submittedAt: new Date(), decisionComment: null });
        await audit(tx, actor, plan.id, "UPDATE", { status: version.status }, { status: "PENDING_APPROVAL", versionNumber: version.versionNumber, comment });
        await notifyCommissionApprovers(tx, actor, [actor.userId, version.createdByUserId, version.updatedByUserId], `Commission plan ${label} waits for approval`, plan.name);
      });
      break;
    }
    case "return-to-draft": {
      await PermissionService.assert(actor.userId, "sales_commissions", "edit");
      need(["PENDING_APPROVAL"], "returned to draft");
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, version, { status: "DRAFT", submittedByUserId: null, submittedAt: null });
        await audit(tx, actor, plan.id, "UPDATE", { status: version.status }, { status: "DRAFT", versionNumber: version.versionNumber });
      });
      break;
    }
    case "send-back": {
      await PermissionService.assert(actor.userId, "sales_commissions", "reject");
      const { reason } = reasonSchema.parse(raw ?? {});
      need(["PENDING_APPROVAL"], "sent back");
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, version, { status: "DRAFT", decisionComment: reason, submittedByUserId: null, submittedAt: null });
        await audit(tx, actor, plan.id, "REJECT", { status: version.status }, { status: "DRAFT", versionNumber: version.versionNumber, reason });
      });
      break;
    }
    case "approve": {
      await PermissionService.assert(actor.userId, "sales_commissions", "approve");
      const { comment } = commentSchema.parse(raw ?? {});
      need(["PENDING_APPROVAL"], "approved");
      if (!(await canApproveCommission(actor.userId, [version.createdByUserId, version.updatedByUserId, version.submittedByUserId]))) {
        throw new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "Someone other than the person who prepared or submitted this version must approve it.");
      }
      // Earned months are never re-valued: a version can't start inside a month that already has a submitted / approved statement.
      // Checked by statement month (not event date) so a late invoice dated inside a closed month is never valued by a newer rule.
      const frozen = await prisma.salesCommissionStatement.findFirst({
        where: { companyId: actor.companyId, status: { in: ["PENDING_APPROVAL", "APPROVED"] }, periodEnd: { gte: version.effectiveFrom }, lines: { some: { planId: plan.id, kind: "EARNING" } } },
        orderBy: { periodEnd: "desc" },
        select: { periodEnd: true },
      });
      if (frozen) throw new BusinessRuleError("VALIDATION_ERROR", `Commission on this plan up to ${dbDate(frozen.periodEnd)} is already in a submitted or approved statement. Start the new version after that date.`, { fieldErrors: { effectiveFrom: "Too early." } });
      try {
        await prisma.$transaction(async (tx) => {
          await guardedMove(tx, version, { status: "APPROVED", approvedByUserId: actor.userId, approvedAt: new Date(), decisionComment: comment || null });
          await audit(tx, actor, plan.id, "APPROVE", { status: version.status }, { status: "APPROVED", versionNumber: version.versionNumber, effectiveFrom: dbDate(version.effectiveFrom) });
          for (const userId of new Set([version.createdByUserId, version.submittedByUserId].filter((u): u is string => Boolean(u) && u !== actor.userId))) {
            await createNotification({ companyId: actor.companyId, userId, title: `Commission plan ${label} approved`, body: `In force from ${dbDate(version.effectiveFrom)}.` }, tx);
          }
        });
      } catch (error) {
        uniqueViolation(error);
      }
      break;
    }
    case "withdraw": {
      await PermissionService.assert(actor.userId, "sales_commissions", "edit");
      const { reason } = reasonSchema.parse(raw ?? {});
      need(["APPROVED"], "withdrawn");
      if (dbDate(version.effectiveFrom) <= todayIsoDate()) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This version has already started. Start a new version to change the plan from a date.");
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, version, { status: "WITHDRAWN" });
        await audit(tx, actor, plan.id, "UPDATE", { status: version.status }, { status: "WITHDRAWN", versionNumber: version.versionNumber, reason });
      });
      break;
    }
    case "discard": {
      await PermissionService.assert(actor.userId, "sales_commissions", "edit");
      need(["DRAFT"], "discarded");
      const others = await prisma.salesCommissionPlanVersion.count({ where: { planId: plan.id, id: { not: version.id } } });
      const used = await prisma.salesCommissionAssignment.count({ where: { planId: plan.id } });
      if (!others && used) throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", "People are assigned to this plan. Remove the assignments first.");
      await prisma.$transaction(async (tx) => {
        await tx.salesCommissionPlanVersion.deleteMany({ where: { id: version.id, status: "DRAFT" } });
        if (!others) await tx.salesCommissionPlan.delete({ where: { id: plan.id } });
        await audit(tx, actor, plan.id, others ? "UPDATE" : "DELETE", { versionNumber: version.versionNumber }, others ? { discarded: true } : null);
      });
      if (!others) return { id: plan.id, deleted: true as const };
      break;
    }
    default:
      throw new BusinessRuleError("NOT_FOUND", "Unknown version action.", { action });
  }
  return getPlan(actor, planId);
}

// ── Assignments ──────────────────────────────────────────────────

const overlaps = (a: { start: string; end: string | null }, b: { start: string; end: string | null }) => a.start <= (b.end ?? "9999-12-31") && b.start <= (a.end ?? "9999-12-31");

export async function addAssignment(actor: SalesActor, planId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_commissions", "edit");
  const input = assignmentSchema.parse(raw);
  const plan = await loadPlan(actor, planId);
  if (!plan.isActive) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Reactivate the plan before assigning people.");
  const end = input.endDate || null;
  if (end && end < input.startDate) throw new BusinessRuleError("VALIDATION_ERROR", "The end date is before the start date.", { fieldErrors: { endDate: "Before the start date." } });
  let payee: { userId: string | null; salesAgentId: string | null; name: string };
  if (plan.payeeType === "REP") {
    if (!input.userId) throw new BusinessRuleError("VALIDATION_ERROR", "Choose the sales rep.", { fieldErrors: { userId: "Required." } });
    const u = await assertEligibleRep(actor, input.userId);
    payee = { userId: u.id, salesAgentId: null, name: u.fullName };
  } else {
    if (!input.salesAgentId) throw new BusinessRuleError("VALIDATION_ERROR", "Choose the sales agent.", { fieldErrors: { salesAgentId: "Required." } });
    const a = await prisma.salesAgent.findFirst({ where: { id: input.salesAgentId, companyId: actor.companyId, isActive: true }, select: { id: true, name: true } });
    if (!a) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active sales agent.", { fieldErrors: { salesAgentId: "Not an active agent." } });
    payee = { userId: null, salesAgentId: a.id, name: a.name };
  }
  await prisma.$transaction(
    async (tx) => {
      // One plan in force per payee per day (no stacking), across all plans of this payee type.
      const existing = await tx.salesCommissionAssignment.findMany({
        where: { companyId: actor.companyId, payeeType: plan.payeeType, ...(payee.userId ? { userId: payee.userId } : { salesAgentId: payee.salesAgentId }) },
        include: { plan: { select: { code: true } } },
      });
      for (const a of existing) {
        if (overlaps({ start: input.startDate, end }, { start: dbDate(a.startDate), end: a.endDate ? dbDate(a.endDate) : null })) {
          throw new BusinessRuleError("VALIDATION_ERROR", `${payee.name} is already on plan ${a.plan.code} for part of those dates. End that assignment first.`, { fieldErrors: { startDate: "Overlaps another assignment." } });
        }
      }
      const created = await tx.salesCommissionAssignment.create({
        data: { companyId: actor.companyId, planId: plan.id, payeeType: plan.payeeType, userId: payee.userId, salesAgentId: payee.salesAgentId, startDate: toDbDate(input.startDate), endDate: end ? toDbDate(end) : null, createdByUserId: actor.userId },
      });
      await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "sales_commission_assignments", recordId: created.id, action: "CREATE", newValues: { planId: plan.id, payee: payee.name, startDate: input.startDate, endDate: end } }, tx);
    },
    { isolationLevel: "Serializable" }
  );
  return getPlan(actor, planId);
}

export async function endAssignment(actor: SalesActor, planId: string, assignmentId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_commissions", "edit");
  const { endDate } = z.object({ endDate: isoDateSchema }).strict().parse(raw);
  const a = await prisma.salesCommissionAssignment.findFirst({ where: { id: assignmentId, planId, companyId: actor.companyId } });
  if (!a) throw new BusinessRuleError("NOT_FOUND", "Assignment not found.");
  if (endDate < dbDate(a.startDate)) throw new BusinessRuleError("VALIDATION_ERROR", "The end date is before the start date.", { fieldErrors: { endDate: "Before the start date." } });
  if (a.endDate && endDate > dbDate(a.endDate)) throw new BusinessRuleError("VALIDATION_ERROR", "An assignment can only be ended earlier. Add a new one instead.", { fieldErrors: { endDate: "Later than the current end." } });
  await prisma.$transaction(async (tx) => {
    await tx.salesCommissionAssignment.updateMany({ where: { id: a.id, companyId: actor.companyId }, data: { endDate: toDbDate(endDate) } });
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "sales_commission_assignments", recordId: a.id, action: "UPDATE", oldValues: { endDate: a.endDate ? dbDate(a.endDate) : null }, newValues: { endDate } }, tx);
  });
  return getPlan(actor, planId);
}

export async function removeAssignment(actor: SalesActor, planId: string, assignmentId: string) {
  await PermissionService.assert(actor.userId, "sales_commissions", "edit");
  const a = await prisma.salesCommissionAssignment.findFirst({ where: { id: assignmentId, planId, companyId: actor.companyId } });
  if (!a) throw new BusinessRuleError("NOT_FOUND", "Assignment not found.");
  if (dbDate(a.startDate) <= todayIsoDate()) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This assignment has already started. End it instead, so its history is kept.");
  await prisma.$transaction(async (tx) => {
    await tx.salesCommissionAssignment.deleteMany({ where: { id: a.id, companyId: actor.companyId } });
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "sales_commission_assignments", recordId: a.id, action: "DELETE", oldValues: { planId, startDate: dbDate(a.startDate) }, newValues: undefined }, tx);
  });
  return getPlan(actor, planId);
}

// ── Read ─────────────────────────────────────────────────────────

export async function listPlans(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_commissions", "view");
  const f = z.object({ status: z.enum(["active", "inactive", "all"]).optional().or(z.literal("")), payeeType: z.enum(["REP", "AGENT"]).optional().or(z.literal("")) }).parse(raw ?? {});
  const today = toDbDate(todayIsoDate());
  const rows = await prisma.salesCommissionPlan.findMany({
    where: { companyId: actor.companyId, ...(f.payeeType ? { payeeType: f.payeeType } : {}), ...(!f.status || f.status === "active" ? { isActive: true } : f.status === "inactive" ? { isActive: false } : {}) },
    orderBy: { code: "asc" },
    include: {
      versions: { orderBy: { versionNumber: "desc" } },
      _count: { select: { assignments: { where: { startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] } } } },
    },
  });
  return rows.map((p) => {
    const inForce = p.versions.filter((v) => v.status === "APPROVED" && v.effectiveFrom <= today && (!v.effectiveTo || v.effectiveTo >= today)).sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
    const open = p.versions.find((v) => v.status === "DRAFT" || v.status === "PENDING_APPROVAL");
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      payeeType: p.payeeType,
      basis: p.basis,
      active: p.isActive,
      inForce: inForce ? { versionNumber: inForce.versionNumber, summary: ruleSummary(ruleOf(inForce)) } : null,
      open: open ? { versionNumber: open.versionNumber, status: open.status } : null,
      payeesNow: p._count.assignments,
    };
  });
}

export function ruleSummary(rule: CommissionRule): string {
  const inr = (v: number) => `₹${v.toLocaleString("en-IN")}`;
  const parts: string[] = [];
  if (rule.method === "FIXED") parts.push(`${inr(rule.fixedAmount ?? 0)} per invoice`);
  else if (rule.tiers.length === 1) parts.push(`${rule.tiers[0].rate}%`);
  else parts.push(`${rule.tierMode === "PROGRESSIVE" ? "Progressive" : "All-units"} tiers: ${rule.tiers.map((t) => `${t.rate}% from ${inr(t.from)}`).join(", ")}`);
  if (rule.minimumBasis) parts.push(`min basis ${inr(rule.minimumBasis)}`);
  if (rule.capAmount) parts.push(`cap ${inr(rule.capAmount)}/month`);
  return parts.join(" · ");
}

export async function getPlan(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "sales_commissions", "view");
  const p = await prisma.salesCommissionPlan.findFirst({
    where: { id, companyId: actor.companyId },
    include: {
      createdBy: { select: { fullName: true } },
      versions: { orderBy: { versionNumber: "desc" }, include: { createdBy: { select: { fullName: true } }, submittedBy: { select: { fullName: true } }, approvedBy: { select: { fullName: true } } } },
      assignments: { orderBy: { startDate: "desc" }, include: { user: { select: { fullName: true } }, salesAgent: { select: { name: true, code: true } } } },
    },
  });
  if (!p) throw new BusinessRuleError("NOT_FOUND", "Commission plan not found.", { id });
  const open = p.versions.find((v) => v.status === "PENDING_APPROVAL");
  const today = todayIsoDate();
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    payeeType: p.payeeType,
    basis: p.basis,
    active: p.isActive,
    createdBy: p.createdBy.fullName,
    viewerCanApprove: open ? await canApproveCommission(actor.userId, [open.createdByUserId, open.updatedByUserId, open.submittedByUserId]) : false,
    versions: p.versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      status: v.status,
      effectiveFrom: dbDate(v.effectiveFrom),
      effectiveTo: v.effectiveTo ? dbDate(v.effectiveTo) : null,
      method: v.method,
      tierMode: v.tierMode,
      tiers: v.tiers as unknown as CommissionTier[],
      fixedAmount: v.fixedAmount === null ? null : Number(v.fixedAmount),
      minimumBasis: v.minimumBasis === null ? null : Number(v.minimumBasis),
      capAmount: v.capAmount === null ? null : Number(v.capAmount),
      notes: v.notes,
      version: v.version,
      summary: ruleSummary(ruleOf(v)),
      createdBy: v.createdBy.fullName,
      submittedBy: v.submittedBy?.fullName ?? null,
      approvedBy: v.approvedBy?.fullName ?? null,
      approvedAt: v.approvedAt?.toISOString() ?? null,
      decisionComment: v.decisionComment,
    })),
    assignments: p.assignments.map((a) => {
      const start = dbDate(a.startDate);
      const end = a.endDate ? dbDate(a.endDate) : null;
      return {
        id: a.id,
        payee: a.user?.fullName ?? (a.salesAgent ? `${a.salesAgent.name} (${a.salesAgent.code})` : "—"),
        startDate: start,
        endDate: end,
        state: start > today ? ("UPCOMING" as const) : end && end < today ? ("ENDED" as const) : ("CURRENT" as const),
      };
    }),
  };
}
