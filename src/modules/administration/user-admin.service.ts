import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { hashPassword } from "@/core/auth/password";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { UserAdminRepository, UserAdminScopeRepository } from "./user-admin.repository";
import type { AddUserBranchRoleInput, CreateUserInput, UpdateUserInput } from "./user-admin.schema";

export interface ActorContext {
  companyId: string;
  userId: string;
}

export async function listUsers(companyId: string) {
  return UserAdminRepository.findMany(companyId);
}

/** Shared by createUser/updateUser — the Employee must belong to this
 * company, and (User.employeeId being @unique) must not already be linked to
 * a different login. `excludeUserId` lets an update re-save a user's own
 * already-linked employeeId without tripping the "already linked" check. */
async function assertEmployeeLinkable(companyId: string, employeeId: string, excludeUserId?: string) {
  const employee = await UserAdminScopeRepository.findEmployeeCompanyId(employeeId);
  if (!employee || employee.companyId !== companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Employee not found.", { id: employeeId });
  }
  const linkedUser = await UserAdminScopeRepository.findUserIdByEmployeeId(employeeId);
  if (linkedUser && linkedUser.id !== excludeUserId) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", "This Employee is already linked to another user login.", { employeeId });
  }
}

/**
 * The only way to create a non-Super-Admin user or assign a real role today
 * — previously there was no such path anywhere in the app (only the
 * database seed created a user, ever), which structurally blocked ever
 * exercising this codebase's own well-built RBAC matrix beyond a single
 * Super Admin account.
 */
export async function createUser(actor: ActorContext, input: CreateUserInput) {
  const existing = await UserAdminRepository.findByEmail(input.email);
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_EMAIL_EXISTS", `A user with email "${input.email}" already exists.`, { email: input.email });
  }

  // The picker endpoints (/api/v1/branches, /api/v1/roles) already scope by
  // companyId, but that only constrains the UI — a direct API call could
  // otherwise submit another tenant's branchId/roleId and create a
  // cross-tenant-inconsistent UserBranchRole. Checked here, server-side,
  // before anything is written.
  const [branch, role] = await Promise.all([
    UserAdminScopeRepository.findBranchCompanyId(input.branchId),
    UserAdminScopeRepository.findRoleCompanyId(input.roleId),
  ]);
  if (!branch || branch.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Branch not found.", { id: input.branchId });
  }
  if (!role || role.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Role not found.", { id: input.roleId });
  }
  if (input.employeeId) {
    await assertEmployeeLinkable(actor.companyId, input.employeeId);
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.$transaction((tx) =>
    UserAdminRepository.createWithRoleInTx(
      tx,
      {
        companyId: actor.companyId,
        email: input.email,
        fullName: input.fullName,
        passwordHash,
        phone: input.phone || null,
        defaultBranchId: input.branchId,
        employeeId: input.employeeId || null,
        status: "ACTIVE",
      },
      { branchId: input.branchId, roleId: input.roleId }
    )
  );

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "users",
    recordId: user.id,
    action: "CREATE",
    // Never log the password/hash itself.
    newValues: { email: input.email, fullName: input.fullName, roleId: input.roleId, branchId: input.branchId, employeeId: input.employeeId || null },
  });

  return user;
}

/**
 * Name/email/phone only — never password (see resetUserPassword below) and
 * never status/role (each has its own dedicated, more tightly-scoped
 * action). Email uniqueness is re-checked here even though the DB column is
 * itself unique, so a collision surfaces as a clean DUPLICATE_EMAIL_EXISTS
 * rather than a raw constraint violation.
 */
export async function updateUser(actor: ActorContext, id: string, input: UpdateUserInput) {
  const existing = await UserAdminRepository.findById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "User not found.", { id });

  if (input.email && input.email !== existing.email) {
    const emailOwner = await UserAdminRepository.findByEmail(input.email);
    if (emailOwner) {
      throw new BusinessRuleError("DUPLICATE_EMAIL_EXISTS", `A user with email "${input.email}" already exists.`, { email: input.email });
    }
  }
  if (input.employeeId !== undefined && input.employeeId && input.employeeId !== existing.employeeId) {
    await assertEmployeeLinkable(actor.companyId, input.employeeId, id);
  }

  const updated = await UserAdminRepository.updateProfile(id, {
    ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
    ...(input.employeeId !== undefined ? { employeeId: input.employeeId || null } : {}),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "users",
    recordId: id,
    action: "UPDATE",
    oldValues: { fullName: existing.fullName, email: existing.email, phone: existing.phone, employeeId: existing.employeeId },
    newValues: { fullName: updated.fullName, email: updated.email, phone: updated.phone, employeeId: updated.employeeId },
  });

  return updated;
}

/**
 * A user can hold more than one Branch+Role assignment (UserBranchRole has
 * no per-user cardinality limit in the schema) — this lets an admin add or
 * remove one after the fact, instead of being stuck with whatever was
 * picked at createUser() time. Same cross-tenant FK check as createUser()'s
 * own — never trust a client-supplied branchId/roleId belongs to this
 * company without checking server-side.
 */
export async function addUserBranchRole(actor: ActorContext, userId: string, input: AddUserBranchRoleInput) {
  const user = await UserAdminRepository.findById(actor.companyId, userId);
  if (!user) throw new BusinessRuleError("NOT_FOUND", "User not found.", { id: userId });

  const [branch, role] = await Promise.all([
    UserAdminScopeRepository.findBranchCompanyId(input.branchId),
    UserAdminScopeRepository.findRoleCompanyId(input.roleId),
  ]);
  if (!branch || branch.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Branch not found.", { id: input.branchId });
  }
  if (!role || role.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Role not found.", { id: input.roleId });
  }
  if (user.branchRoles.some((br) => br.branch.id === input.branchId && br.role.id === input.roleId)) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", "This user already has that exact role on that branch.", {});
  }

  const created = await UserAdminRepository.addBranchRole(userId, input.branchId, input.roleId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "user_branch_roles",
    recordId: created.id,
    action: "CREATE",
    newValues: { userId, branchId: input.branchId, roleId: input.roleId },
  });

  return UserAdminRepository.findById(actor.companyId, userId);
}

/**
 * Structurally blocked from ever leaving a user with zero role assignments
 * — that would be indistinguishable from a broken account (same reasoning
 * createWithRoleInTx's own doc comment gives for requiring one at creation).
 */
export async function removeUserBranchRole(actor: ActorContext, userId: string, branchRoleId: string) {
  const user = await UserAdminRepository.findById(actor.companyId, userId);
  if (!user) throw new BusinessRuleError("NOT_FOUND", "User not found.", { id: userId });

  const existing = user.branchRoles.find((br) => br.id === branchRoleId);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Role assignment not found.", { id: branchRoleId });

  if (user.branchRoles.length <= 1) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Cannot remove a user's last role assignment — they would have no access at all. Add a replacement role first.",
      {}
    );
  }

  await UserAdminRepository.removeBranchRole(branchRoleId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "user_branch_roles",
    recordId: branchRoleId,
    action: "DELETE",
    oldValues: existing,
  });

  return UserAdminRepository.findById(actor.companyId, userId);
}

export async function setUserStatus(actor: ActorContext, id: string, status: "ACTIVE" | "SUSPENDED") {
  const existing = await UserAdminRepository.findById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "User not found.", { id });
  if (existing.id === actor.userId && status === "SUSPENDED") {
    throw new BusinessRuleError("VALIDATION_ERROR", "You cannot suspend your own account.", {});
  }

  const updated = await UserAdminRepository.updateStatus(id, status);

  // isUserActive() re-checks the DB on every PermissionService call and
  // is not itself cached, so this isn't required for the suspend-takes-
  // effect guarantee — it's here so a role/permission change bundled with
  // this action (or a future one) doesn't ride along on a stale cache too.
  PermissionService.invalidate(id);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "users",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: existing.status },
    newValues: { status },
  });

  return updated;
}

/**
 * Admin-triggered "set new password" — the audit's own stated minimum bar
 * for account recovery (this app has no email/forgot-password infra to
 * build a self-service reset flow on top of). Company-scoped via the same
 * `findById` pattern setUserStatus already uses, so an admin from one
 * company can never reset a user in another. No current-password check —
 * that's the entire point of an admin reset (the user may have forgotten
 * it) — the RBAC gate (`administration.edit`, asserted at the route layer)
 * is what actually authorizes this.
 */
export async function resetUserPassword(actor: ActorContext, id: string, newPassword: string): Promise<void> {
  const existing = await UserAdminRepository.findById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "User not found.", { id });

  const passwordHash = await hashPassword(newPassword);
  await UserAdminRepository.updatePasswordHash(id, passwordHash);

  // Same reasoning as setUserStatus's own invalidate() call — not required
  // for the session-invalidation guarantee itself (PermissionService/
  // requireSession both re-check passwordChangedAt live, uncached), just
  // keeps the permission-key cache from riding along stale too.
  PermissionService.invalidate(id);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "users",
    recordId: id,
    action: "UPDATE",
    // Never the password/hash itself — only the fact that it was reset.
    newValues: { passwordReset: true },
  });
}
