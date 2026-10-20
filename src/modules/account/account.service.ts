import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { hashPassword, verifyPassword } from "@/core/auth/password";
import { UserAdminRepository } from "@/modules/administration/user-admin.repository";
import type { ChangePasswordInput } from "./account.schema";
import { TEMPORARY_EMPLOYEE_PASSWORD } from "@/modules/administration/temporary-password";

export interface ActorContext {
  companyId: string;
  userId: string;
}

/**
 * Self-service only — always scoped to the authenticated caller's own row,
 * by construction (there is no `id` parameter to mistarget). No RBAC
 * permission is required: this isn't a business-data module action, it's
 * the same self-scoped category as "view your own session" — every
 * authenticated, active user may change their own password, and
 * requireSession() has already confirmed both of those before this
 * function is ever reached.
 */
export async function changeOwnPassword(actor: ActorContext, input: ChangePasswordInput): Promise<void> {
  const user = await UserAdminRepository.findByIdWithPasswordHash(actor.userId);
  if (!user) throw new BusinessRuleError("NOT_FOUND", "User not found.", { id: actor.userId });

  const currentPasswordValid = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!currentPasswordValid) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Current password is incorrect.", {});
  }
  // P2: the new password must really be new -- not the temporary onboarding
  // password, and not the password they already have.
  if (input.newPassword === TEMPORARY_EMPLOYEE_PASSWORD) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Choose your own password -- the temporary password can't be used.", {});
  }
  if (input.newPassword === input.currentPassword) {
    throw new BusinessRuleError("VALIDATION_ERROR", "The new password must be different from your current password.", {});
  }

  const newPasswordHash = await hashPassword(input.newPassword);
  // Clears mustChangePassword: the user now has a password only they know.
  await UserAdminRepository.updatePasswordHash(actor.userId, newPasswordHash, false);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "users",
    recordId: actor.userId,
    action: "UPDATE",
    // Never the password/hash itself — only the fact that it changed.
    newValues: { passwordChanged: true },
  });
}
