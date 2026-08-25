import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

const USER_INCLUDE = {
  defaultBranch: { select: { id: true, name: true } },
  branchRoles: {
    include: {
      role: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
  },
} as const;

export const UserAdminRepository = {
  findMany: (companyId: string) =>
    prisma.user.findMany({ where: { companyId }, include: USER_INCLUDE, orderBy: { createdAt: "desc" } }),

  findByEmail: (email: string) => prisma.user.findUnique({ where: { email } }),

  findById: (companyId: string, id: string) => prisma.user.findFirst({ where: { id, companyId }, include: USER_INCLUDE }),

  /** Creates the User row and its one initial UserBranchRole assignment in a
   * single transaction — a user with no role assignment at all would be
   * indistinguishable from a broken invite, so the two always happen
   * together, never as two separate calls a caller could interrupt. */
  createWithRoleInTx: (
    tx: Prisma.TransactionClient,
    data: Prisma.UserUncheckedCreateInput,
    roleAssignment: { branchId: string; roleId: string }
  ) =>
    tx.user.create({
      data: { ...data, branchRoles: { create: [roleAssignment] } },
      include: USER_INCLUDE,
    }),

  updateStatus: (id: string, status: "ACTIVE" | "SUSPENDED") =>
    prisma.user.update({ where: { id }, data: { status }, include: USER_INCLUDE }),
};

/**
 * Scoped existence checks for createUser()'s own defensive company-ownership
 * check before creating a UserBranchRole — the picker endpoints
 * (/api/v1/branches, /api/v1/roles) already scope by companyId, but that
 * only constrains the UI; a direct API call could otherwise submit another
 * tenant's branchId/roleId and create a cross-tenant-inconsistent role
 * assignment, the exact bug class this project has already found and fixed
 * repeatedly elsewhere (never trust a client-supplied FK belongs to your
 * company without checking it server-side).
 */
export const UserAdminScopeRepository = {
  findBranchCompanyId: (id: string) => prisma.branch.findUnique({ where: { id }, select: { companyId: true } }),
  findRoleCompanyId: (id: string) => prisma.role.findUnique({ where: { id }, select: { companyId: true } }),
};
