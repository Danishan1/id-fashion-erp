import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { round2 } from "@/lib/money";
import type { PaymentRequestRouting, PaymentRequestType } from "@prisma/client";
import { ApprovalMatrixRepository } from "./approval-matrix.repository";
import type { ApprovalRuleInput } from "./approval-matrix.schema";
import { PAYMENT_REQUEST_TYPE_DEFS } from "./request-type-registry";

/**
 * Payment Request Approval Matrix (2026-10-27): who approves which request
 * type, by branch and amount slab, in 1..3 levels, and whether an approver
 * may also pay. A request freezes its plan when raised (approvalPlanJson),
 * so editing the matrix never changes a request already in flight.
 */

interface ActorContext {
  companyId: string;
  userId: string;
}

export interface ApprovalPlanLevel {
  level: number;
  /** No matrix rule: anyone holding payment_requests.approve may decide. */
  anyApprover: boolean;
  users: { id: string; name: string }[];
  roles: { id: string; name: string }[];
}

export interface ApprovalPlan {
  ruleId: string | null;
  routing: PaymentRequestRouting;
  approverMayPay: boolean;
  levels: ApprovalPlanLevel[];
}

/** Columns a request stores for the level that is currently waiting. */
export function currentLevelColumns(plan: ApprovalPlan, level: number) {
  const current = plan.levels.find((l) => l.level === level);
  return {
    currentApprovalLevel: level,
    currentLevelAnyApprover: current?.anyApprover ?? true,
    currentApproverUserIds: current?.users.map((u) => u.id) ?? [],
    currentApproverRoleIds: current?.roles.map((r) => r.id) ?? [],
  };
}

/** Everything a request stores about its approval when raised (or re-planned on edit). */
export function planColumns(plan: ApprovalPlan) {
  const direct = plan.routing === "DIRECT_TO_ACCOUNTANT";
  return {
    status: direct ? ("APPROVED" as const) : ("PENDING_APPROVAL" as const),
    routing: plan.routing,
    approvalRuleId: plan.ruleId,
    approvalPlanJson: plan as unknown as object,
    requiredApprovalLevels: direct ? 0 : plan.levels.length,
    approverMayPay: plan.approverMayPay,
    ...currentLevelColumns(plan, 1),
  };
}

const inSlab = (amount: number, min: number, max: number | null) => amount >= min && (max === null || amount < max);

/**
 * Picks the rule for a request: a branch-specific rule beats an all-branch one;
 * within those, the slab containing the amount. No rule = the type's default
 * routing with one "any approver" level.
 */
export async function resolveApprovalPlan(
  companyId: string,
  requestType: PaymentRequestType,
  branchId: string | null,
  amount: number
): Promise<ApprovalPlan> {
  const rules = await ApprovalMatrixRepository.findActiveRulesFor(companyId, requestType, branchId);
  const matching = rules.filter((r) => inSlab(amount, Number(r.minAmount), r.maxAmount === null ? null : Number(r.maxAmount)));
  const rule = matching.find((r) => r.branchId !== null) ?? matching.find((r) => r.branchId === null);

  if (!rule) {
    return {
      ruleId: null,
      routing: PAYMENT_REQUEST_TYPE_DEFS[requestType].routing,
      approverMayPay: false,
      levels: [{ level: 1, anyApprover: true, users: [], roles: [] }],
    };
  }

  const levels: ApprovalPlanLevel[] =
    rule.routing === "DIRECT_TO_ACCOUNTANT"
      ? []
      : Array.from({ length: rule.approvalLevels }, (_, i) => {
          const at = rule.approvers.filter((a) => a.level === i + 1);
          return {
            level: i + 1,
            anyApprover: false,
            users: at.filter((a) => a.user).map((a) => ({ id: a.user!.id, name: a.user!.fullName })),
            roles: at.filter((a) => a.role).map((a) => ({ id: a.role!.id, name: a.role!.name })),
          };
        });
  return { ruleId: rule.id, routing: rule.routing, approverMayPay: rule.approverMayPay, levels };
}

export interface ApproverIdentity {
  roleIds: string[];
  isSuperAdmin: boolean;
}

export async function getApproverIdentity(userId: string): Promise<ApproverIdentity> {
  const rows = await ApprovalMatrixRepository.findUserRoles(userId);
  return { roleIds: rows.map((r) => r.roleId), isSuperAdmin: rows.some((r) => r.role.name === "SUPER_ADMIN") };
}

/** Is this user one of the approvers of the request's current level? (Super Admin may always decide.) */
export function isListedApprover(
  request: { currentLevelAnyApprover: boolean; currentApproverUserIds: string[]; currentApproverRoleIds: string[] },
  userId: string,
  identity: ApproverIdentity
) {
  if (identity.isSuperAdmin || request.currentLevelAnyApprover) return true;
  return request.currentApproverUserIds.includes(userId) || request.currentApproverRoleIds.some((r) => identity.roleIds.includes(r));
}

// ─── Rule maintenance ──────────────────────────────────────────

async function validateRule(actor: ActorContext, input: ApprovalRuleInput, excludeId?: string) {
  const branchId = input.branchId || null;
  if (branchId && !(await ApprovalMatrixRepository.findBranch(actor.companyId, branchId))) {
    throw new BusinessRuleError("NOT_FOUND", "Branch not found.", { id: branchId });
  }

  const direct = input.routing === "DIRECT_TO_ACCOUNTANT";
  const levels = direct ? 1 : input.approvalLevels;
  const approvers = direct
    ? []
    : input.approvers.map((a) => ({ level: a.level, roleId: a.roleId || null, userId: a.userId || null }));

  for (let level = 1; level <= levels && !direct; level++) {
    if (!approvers.some((a) => a.level === level)) {
      throw new BusinessRuleError("VALIDATION_ERROR", `Choose at least one approver (role or user) for level ${level}.`, { level });
    }
  }
  if (approvers.some((a) => a.level > levels)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `This rule has ${levels} level(s); remove approvers set for higher levels.`);
  }
  const dupKey = new Set<string>();
  for (const a of approvers) {
    const key = `${a.level}:${a.roleId ?? ""}:${a.userId ?? ""}`;
    if (dupKey.has(key)) throw new BusinessRuleError("VALIDATION_ERROR", "The same approver is listed twice on one level.");
    dupKey.add(key);
  }

  const roleIds = [...new Set(approvers.flatMap((a) => (a.roleId ? [a.roleId] : [])))];
  const userIds = [...new Set(approvers.flatMap((a) => (a.userId ? [a.userId] : [])))];
  if (roleIds.length && (await ApprovalMatrixRepository.countCompanyRoles(actor.companyId, roleIds)) !== roleIds.length) {
    throw new BusinessRuleError("NOT_FOUND", "One of the approver roles was not found.");
  }
  if (userIds.length && (await ApprovalMatrixRepository.countCompanyUsers(actor.companyId, userIds)) !== userIds.length) {
    throw new BusinessRuleError("NOT_FOUND", "One of the approver users was not found or is not active.");
  }

  const minAmount = round2(input.minAmount);
  const maxAmount = input.maxAmount === undefined ? null : round2(input.maxAmount);
  await assertNoOverlap(actor.companyId, input.requestType, branchId, minAmount, maxAmount, excludeId);

  return {
    data: {
      requestType: input.requestType,
      branchId,
      minAmount,
      maxAmount,
      routing: input.routing,
      approvalLevels: levels,
      approverMayPay: input.approverMayPay,
    },
    approvers,
  };
}

/** Two active rules for the same type and branch scope may not cover the same amount. */
async function assertNoOverlap(
  companyId: string,
  requestType: PaymentRequestType,
  branchId: string | null,
  min: number,
  max: number | null,
  excludeId?: string
) {
  const siblings = await ApprovalMatrixRepository.findActiveSiblings(companyId, requestType, branchId, excludeId);
  const clash = siblings.find((s) => {
    const sMin = Number(s.minAmount);
    const sMax = s.maxAmount === null ? Infinity : Number(s.maxAmount);
    return min < sMax && sMin < (max ?? Infinity);
  });
  if (clash) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Another active rule for this request type and branch already covers part of this amount range.",
      { conflictingRuleId: clash.id }
    );
  }
}

export async function listApprovalRules(actor: ActorContext) {
  return ApprovalMatrixRepository.findRules(actor.companyId);
}

export async function createApprovalRule(actor: ActorContext, input: ApprovalRuleInput) {
  const { data, approvers } = await validateRule(actor, input);
  const rule = await ApprovalMatrixRepository.createRule({
    companyId: actor.companyId,
    ...data,
    createdByUserId: actor.userId,
    approvers: { create: approvers },
  });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "payment_approval_rules",
    recordId: rule.id,
    action: "CREATE",
    newValues: { ...data, approvers },
  });
  return rule;
}

export async function updateApprovalRule(actor: ActorContext, id: string, input: ApprovalRuleInput) {
  const existing = await ApprovalMatrixRepository.findRule(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Approval rule not found.", { id });

  const { data, approvers } = await validateRule(actor, input, existing.isActive ? id : undefined);
  const rule = await ApprovalMatrixRepository.replaceRule(id, data, approvers);
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "payment_approval_rules",
    recordId: id,
    action: "UPDATE",
    oldValues: {
      minAmount: existing.minAmount,
      maxAmount: existing.maxAmount,
      routing: existing.routing,
      approvalLevels: existing.approvalLevels,
      approverMayPay: existing.approverMayPay,
      approvers: existing.approvers.map((a) => ({ level: a.level, roleId: a.roleId, userId: a.userId })),
    },
    newValues: { ...data, approvers },
  });
  return rule;
}

/** Deactivating stops new requests matching it; requests already raised keep their frozen plan. */
export async function setApprovalRuleActive(actor: ActorContext, id: string, isActive: boolean) {
  const existing = await ApprovalMatrixRepository.findRule(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Approval rule not found.", { id });
  if (isActive && !existing.isActive) {
    await assertNoOverlap(
      actor.companyId,
      existing.requestType,
      existing.branchId,
      Number(existing.minAmount),
      existing.maxAmount === null ? null : Number(existing.maxAmount),
      id
    );
  }
  const rule = await ApprovalMatrixRepository.setActive(id, isActive);
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "payment_approval_rules",
    recordId: id,
    action: "UPDATE",
    oldValues: { isActive: existing.isActive },
    newValues: { isActive },
  });
  return rule;
}
