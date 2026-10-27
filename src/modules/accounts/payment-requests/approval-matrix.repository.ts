import { prisma } from "@/core/db/client";
import type { PaymentRequestType, Prisma } from "@prisma/client";

const RULE_INCLUDE = {
  branch: { select: { id: true, name: true } },
  approvers: {
    orderBy: { level: "asc" },
    include: { role: { select: { id: true, name: true } }, user: { select: { id: true, fullName: true } } },
  },
} satisfies Prisma.PaymentApprovalRuleInclude;

export const ApprovalMatrixRepository = {
  findRules: (companyId: string) =>
    prisma.paymentApprovalRule.findMany({
      where: { companyId },
      include: RULE_INCLUDE,
      orderBy: [{ requestType: "asc" }, { minAmount: "asc" }],
    }),

  findRule: (companyId: string, id: string) =>
    prisma.paymentApprovalRule.findFirst({ where: { id, companyId }, include: RULE_INCLUDE }),

  /** Active rules of one type that apply to this branch (its own rules plus all-branch rules). */
  findActiveRulesFor: (companyId: string, requestType: PaymentRequestType, branchId: string | null) =>
    prisma.paymentApprovalRule.findMany({
      where: { companyId, requestType, isActive: true, OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])] },
      include: RULE_INCLUDE,
    }),

  /** Active rules sharing the same type + branch scope — for the slab-overlap check. */
  findActiveSiblings: (companyId: string, requestType: PaymentRequestType, branchId: string | null, excludeId?: string) =>
    prisma.paymentApprovalRule.findMany({
      where: { companyId, requestType, branchId, isActive: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, minAmount: true, maxAmount: true },
    }),

  createRule: (data: Prisma.PaymentApprovalRuleUncheckedCreateInput) =>
    prisma.paymentApprovalRule.create({ data, include: RULE_INCLUDE }),

  /** Replaces the rule's fields and its approver list in one transaction. */
  replaceRule: (id: string, data: Prisma.PaymentApprovalRuleUncheckedUpdateInput, approvers: { level: number; roleId: string | null; userId: string | null }[]) =>
    prisma.$transaction(async (tx) => {
      await tx.paymentApprovalRuleApprover.deleteMany({ where: { ruleId: id } });
      await tx.paymentApprovalRule.update({ where: { id }, data });
      if (approvers.length > 0) await tx.paymentApprovalRuleApprover.createMany({ data: approvers.map((a) => ({ ...a, ruleId: id })) });
      return tx.paymentApprovalRule.findUniqueOrThrow({ where: { id }, include: RULE_INCLUDE });
    }),

  setActive: (id: string, isActive: boolean) =>
    prisma.paymentApprovalRule.update({ where: { id }, data: { isActive }, include: RULE_INCLUDE }),

  countCompanyRoles: (companyId: string, ids: string[]) => prisma.role.count({ where: { companyId, id: { in: ids } } }),

  countCompanyUsers: (companyId: string, ids: string[]) =>
    prisma.user.count({ where: { companyId, id: { in: ids }, status: "ACTIVE", supportForPlatformUserId: null } }),

  findBranch: (companyId: string, id: string) => prisma.branch.findFirst({ where: { id, companyId }, select: { id: true } }),

  /** The actor's roles (any branch) — ids for matching approvers, names to spot SUPER_ADMIN. */
  findUserRoles: (userId: string) =>
    prisma.userBranchRole.findMany({ where: { userId }, select: { roleId: true, role: { select: { name: true } } } }),

  /** Active users listed directly or through a role — who to notify for a level. */
  findApproverUserIds: async (companyId: string, userIds: string[], roleIds: string[]) => {
    const viaRoles = roleIds.length
      ? await prisma.userBranchRole.findMany({
          where: { roleId: { in: roleIds }, user: { companyId, status: "ACTIVE", supportForPlatformUserId: null } },
          select: { userId: true },
        })
      : [];
    return [...new Set([...userIds, ...viaRoles.map((r) => r.userId)])];
  },
};
