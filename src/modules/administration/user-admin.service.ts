import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { hashPassword } from "@/core/auth/password";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { UserAdminRepository, UserAdminScopeRepository } from "./user-admin.repository";
import type { CreateUserInput } from "./user-admin.schema";

export interface ActorContext {
  companyId: string;
  userId: string;
}

export async function listUsers(companyId: string) {
  return UserAdminRepository.findMany(companyId);
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
    newValues: { email: input.email, fullName: input.fullName, roleId: input.roleId, branchId: input.branchId },
  });

  return user;
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
