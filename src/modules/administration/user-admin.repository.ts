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
  employeeId: true,
  employee: { select: { id: true, fullName: true, employeeCode: true } },
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
    prisma.user.findMany({ where: { companyId, supportForPlatformUserId: null }, select: USER_SELECT, orderBy: { createdAt: "desc" } }),

  /** Emails are stored lower-case (P2) -- callers pass a normalized email. */
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
  /** `mustChangePassword`: true after an admin reset (a temporary password),
   * false after the user changes it themselves (P2). */
  updatePasswordHash: (id: string, passwordHash: string, mustChangePassword = false) =>
    prisma.user.update({
      where: { id },
      data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword },
      select: { id: true },
    }),

  findByIdWithPasswordHash: (id: string) =>
    prisma.user.findUnique({ where: { id }, select: { id: true, passwordHash: true } }),

  updateProfile: (id: string, data: { fullName?: string; email?: string; phone?: string | null; employeeId?: string | null }) =>
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
  findEmployeeCompanyId: (id: string) => prisma.employee.findUnique({ where: { id }, select: { companyId: true } }),
  /** User.employeeId is @unique — this is how createUser()/updateUser() catch
   * "already linked to a different login" before the DB constraint would. */
  findUserIdByEmployeeId: (employeeId: string) => prisma.user.findUnique({ where: { employeeId }, select: { id: true } }),
};

/**
 * Read straight from the DB (never from PermissionService's per-user cache):
 * deciding whether an admin may hand out a role is a security check, so it
 * must see the actor's grants as they are right now.
 */
export const RoleGrantRepository = {
  findRoleGrantProfile: (roleId: string) =>
    prisma.role.findUnique({
      where: { id: roleId },
      select: { name: true, rolePermissions: { select: { permission: { select: { key: true } } } } },
    }),
  findUserGrantProfile: async (userId: string) => {
    const assignments = await prisma.userBranchRole.findMany({
      where: { userId },
      select: {
        role: {
          select: { name: true, rolePermissions: { select: { permission: { select: { key: true } } } } },
        },
      },
    });
    const roleNames = new Set<string>();
    const permissionKeys = new Set<string>();
    for (const a of assignments) {
      roleNames.add(a.role.name);
      for (const rp of a.role.rolePermissions) permissionKeys.add(rp.permission.key);
    }
    return { roleNames, permissionKeys };
  },
};
