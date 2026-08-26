import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { RoleAdminRepository } from "./role-admin.repository";
import type { CreateRoleInput } from "./role-admin.schema";

export interface ActorContext {
  companyId: string;
  userId: string;
}

export async function listRoles(companyId: string) {
  const roles = await RoleAdminRepository.findMany(companyId);
  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isSystemRole: r.isSystemRole,
    permissionCount: r._count.rolePermissions,
    userCount: r._count.userBranchRoles,
  }));
}

export async function createRole(actor: ActorContext, input: CreateRoleInput) {
  const existing = await RoleAdminRepository.findByName(actor.companyId, input.name);
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `A role named "${input.name}" already exists.`, { name: input.name });
  }

  const role = await RoleAdminRepository.create(actor.companyId, { name: input.name, description: input.description || null });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "roles",
    recordId: role.id,
    action: "CREATE",
    newValues: role,
  });

  return role;
}

export async function getRolePermissionMatrix(companyId: string, roleId: string) {
  const role = await RoleAdminRepository.findById(companyId, roleId);
  if (!role) throw new BusinessRuleError("NOT_FOUND", "Role not found.", { id: roleId });

  const [catalog, granted] = await Promise.all([
    RoleAdminRepository.findPermissionCatalog(),
    RoleAdminRepository.findGrantedPermissionIds(roleId),
  ]);
  const grantedIds = new Set(granted.map((g) => g.permissionId));

  return {
    role: { id: role.id, name: role.name, description: role.description, isSystemRole: role.isSystemRole },
    catalog: catalog.map((p) => ({ key: p.key, module: p.module, granted: grantedIds.has(p.id) })),
  };
}

/**
 * Blocked entirely for isSystemRole roles (SUPER_ADMIN, MANAGEMENT, ...) —
 * the same protection ChartOfAccount already applies to isSystemAccount:
 * these are the seeded roles every other permission decision in this app
 * assumes exist with their documented shape, and editing one through this
 * UI could silently lock an admin out of their own account. Custom
 * (non-system) roles created via createRole() above are the only ones this
 * ever touches.
 */
export async function updateRolePermissions(actor: ActorContext, roleId: string, grantedKeys: string[]) {
  const role = await RoleAdminRepository.findById(actor.companyId, roleId);
  if (!role) throw new BusinessRuleError("NOT_FOUND", "Role not found.", { id: roleId });
  if (role.isSystemRole) {
    throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", `"${role.name}" is a system role and its permissions cannot be edited.`, { id: roleId });
  }

  const catalog = await RoleAdminRepository.findPermissionCatalog();
  const catalogByKey = new Map(catalog.map((p) => [p.key, p.id]));

  const unknownKeys = grantedKeys.filter((k) => !catalogByKey.has(k));
  if (unknownKeys.length > 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Unknown permission key(s): ${unknownKeys.join(", ")}`, { unknownKeys });
  }

  const permissionIds = grantedKeys.map((k) => catalogByKey.get(k)!);
  await RoleAdminRepository.replacePermissionsInTx(roleId, permissionIds);

  // Every currently-cached user carrying this role would otherwise keep
  // acting on the pre-edit permission set until their own cache entry
  // happens to expire — same reasoning setUserStatus()/resetUserPassword()
  // already apply to PermissionService's per-user cache.
  PermissionService.invalidate();

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "role_permissions",
    recordId: roleId,
    action: "UPDATE",
    newValues: { roleId, grantedKeys },
  });

  return getRolePermissionMatrix(actor.companyId, roleId);
}
