import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { hashPassword } from "@/core/auth/password";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { UserAdminRepository } from "./user-admin.repository";
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
