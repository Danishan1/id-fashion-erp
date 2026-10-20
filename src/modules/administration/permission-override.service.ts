import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { PermissionService } from "@/core/rbac/PermissionService";
import { ACTIONS, MODULES, type Action, type Module } from "@/config/rbac";

/**
 * P6 (2026-10-21, decisions 11-12): per-user permission overrides.
 * GRANT adds one permission on top of the user's roles; DENY removes one,
 * even if a role grants it. A DENY always wins.
 *
 * Guard rails (same spirit as the P0 role-grant guard):
 *  - nobody overrides their own permissions;
 *  - you can only GRANT a permission you effectively hold yourself;
 *  - only a Super Admin can override another Super Admin.
 */

interface ActorContext {
  companyId: string;
  userId: string;
}

export const setOverrideSchema = z.object({
  module: z.enum(MODULES as unknown as [Module, ...Module[]]),
  action: z.enum(ACTIONS as unknown as [Action, ...Action[]]),
  effect: z.enum(["GRANT", "DENY"]),
  reason: z.string().trim().min(3, "Give a short reason.").max(500),
});
export type SetOverrideInput = z.infer<typeof setOverrideSchema>;

async function isSuperAdmin(userId: string) {
  const count = await prisma.userBranchRole.count({ where: { userId, role: { name: "SUPER_ADMIN" } } });
  return count > 0;
}

async function loadTargetUser(actor: ActorContext, userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: actor.companyId, supportForPlatformUserId: null },
    select: { id: true, fullName: true },
  });
  if (!user) throw new BusinessRuleError("NOT_FOUND", "User not found.", { id: userId });
  return user;
}

async function assertMayOverride(actor: ActorContext, targetUserId: string) {
  if (actor.userId === targetUserId) {
    throw new BusinessRuleError("PERMISSION_DENIED", "You can't change your own permissions.", {});
  }
  if ((await isSuperAdmin(targetUserId)) && !(await isSuperAdmin(actor.userId))) {
    throw new BusinessRuleError("PERMISSION_DENIED", "Only a Super Admin can change a Super Admin's permissions.", {});
  }
}

export async function listUserOverrides(actor: ActorContext, userId: string) {
  await loadTargetUser(actor, userId);
  const rows = await prisma.userPermissionOverride.findMany({
    where: { companyId: actor.companyId, userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      effect: true,
      reason: true,
      createdAt: true,
      permission: { select: { key: true, module: true } },
      createdBy: { select: { id: true, fullName: true } },
    },
  });
  return rows.map((r) => ({ ...r, action: r.permission.key.slice(r.permission.module.length + 1) }));
}

/** Creates or replaces the user's override for one permission. */
export async function setUserOverride(actor: ActorContext, userId: string, input: SetOverrideInput) {
  await loadTargetUser(actor, userId);
  await assertMayOverride(actor, userId);
  if (input.effect === "GRANT" && !(await PermissionService.can(actor.userId, input.module, input.action))) {
    throw new BusinessRuleError(
      "PERMISSION_DENIED",
      `You can only grant permissions you hold yourself (${input.module}.${input.action}).`,
      {}
    );
  }

  const key = `${input.module}.${input.action}`;
  const permission = await prisma.permission.findUnique({ where: { key }, select: { id: true } });
  if (!permission) throw new BusinessRuleError("NOT_FOUND", `Unknown permission ${key}.`, { key });

  const before = await prisma.userPermissionOverride.findUnique({
    where: { userId_permissionId: { userId, permissionId: permission.id } },
    select: { effect: true, reason: true },
  });
  const row = await prisma.userPermissionOverride.upsert({
    where: { userId_permissionId: { userId, permissionId: permission.id } },
    create: {
      companyId: actor.companyId,
      userId,
      permissionId: permission.id,
      effect: input.effect,
      reason: input.reason,
      createdByUserId: actor.userId,
    },
    update: { effect: input.effect, reason: input.reason, createdByUserId: actor.userId, createdAt: new Date() },
  });

  PermissionService.invalidate(userId);
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "user_permission_overrides",
    recordId: row.id,
    action: before ? "UPDATE" : "CREATE",
    oldValues: before ?? undefined,
    newValues: { userId, permission: key, effect: input.effect, reason: input.reason },
  });
  return row;
}

export async function removeUserOverride(actor: ActorContext, userId: string, overrideId: string) {
  await loadTargetUser(actor, userId);
  await assertMayOverride(actor, userId);
  const row = await prisma.userPermissionOverride.findFirst({
    where: { id: overrideId, userId, companyId: actor.companyId },
    select: { id: true, effect: true, reason: true, permission: { select: { key: true } } },
  });
  if (!row) throw new BusinessRuleError("NOT_FOUND", "Override not found.", { id: overrideId });
  await prisma.userPermissionOverride.delete({ where: { id: overrideId } });

  PermissionService.invalidate(userId);
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "user_permission_overrides",
    recordId: overrideId,
    action: "DELETE",
    oldValues: { userId, permission: row.permission.key, effect: row.effect, reason: row.reason },
  });
}
