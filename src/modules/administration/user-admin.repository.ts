import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

// A `select`, not an `include` — `include` returns every scalar column of
// the base model in addition to the named relations, which was silently
// returning `passwordHash` (a real bcrypt hash) in every one of these
// responses. Every field the UI actually needs is named explicitly here.
const USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  status: true,
  defaultBranchId: true,
  createdAt: true,
  updatedAt: true,
  defaultBranch: { select: { id: true, name: true } },
  branchRoles: {
    select: {
      id: true,
      role: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
  },
} as const;

export const UserAdminRepository = {
  findMany: (companyId: string) =>
    prisma.user.findMany({ where: { companyId }, select: USER_SELECT, orderBy: { createdAt: "desc" } }),

  findByEmail: (email: string) => prisma.user.findUnique({ where: { email } }),

  findById: (companyId: string, id: string) => prisma.user.findFirst({ where: { id, companyId }, select: USER_SELECT }),

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
      select: USER_SELECT,
    }),

  updateStatus: (id: string, status: "ACTIVE" | "SUSPENDED") =>
    prisma.user.update({ where: { id }, data: { status }, select: USER_SELECT }),

  /**
   * Shared by both the self-service change-password flow (src/modules/account/)
   * and the admin-reset flow below — the same underlying write either way.
   * Always stamps passwordChangedAt in the same update, never as a separate
   * call, so the two can never drift out of sync. Returns only `{ id }` —
   * this function's whole purpose is writing a bcrypt hash, so its own
   * return value must never be capable of leaking one back to a caller.
   */
  updatePasswordHash: (id: string, passwordHash: string) =>
    prisma.user.update({ where: { id }, data: { passwordHash, passwordChangedAt: new Date() }, select: { id: true } }),

  findByIdWithPasswordHash: (id: string) =>
    prisma.user.findUnique({ where: { id }, select: { id: true, passwordHash: true } }),

  updateProfile: (id: string, data: { fullName?: string; email?: string; phone?: string | null }) =>
    prisma.user.update({ where: { id }, data, select: USER_SELECT }),

  countBranchRoles: (userId: string) => prisma.userBranchRole.count({ where: { userId } }),

  addBranchRole: (userId: string, branchId: string, roleId: string) =>
    prisma.userBranchRole.create({ data: { userId, branchId, roleId }, select: { id: true } }),

  removeBranchRole: (id: string) => prisma.userBranchRole.delete({ where: { id } }),
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
