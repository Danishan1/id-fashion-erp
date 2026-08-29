import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { RoleAdminRepository } from "./role-admin.repository";
import type { CreateRoleInput, UpdateRoleProductionStagesInput } from "./role-admin.schema";

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

export async function getRoleProductionStageAccess(companyId: string, roleId: string) {
  const role = await RoleAdminRepository.findById(companyId, roleId);
  if (!role) throw new BusinessRuleError("NOT_FOUND", "Role not found.", { id: roleId });

  const [stages, granted] = await Promise.all([
    RoleAdminRepository.findActiveProductionStages(companyId),
    RoleAdminRepository.findGrantedStageIds(roleId),
  ]);
  const grantedIds = new Set(granted.map((g) => g.productionStageId));

  return {
    role: { id: role.id, name: role.name },
    // Zero rows granted = unrestricted (every stage) — surfaced explicitly
    // here rather than left for the UI to infer, so "restricted to nothing"
    // (a genuine misconfiguration mistake) and "restricted to everything by
    // omission" can never be confused with each other.
    isRestricted: grantedIds.size > 0,
    stages: stages.map((s) => ({ id: s.id, name: s.name, code: s.code, granted: grantedIds.has(s.id) })),
  };
}

/**
 * Deliberately allowed on system roles too — unlike updateRolePermissions()
 * above. Stage restriction is a purely additive/narrowing dimension layered
 * on top of a role's existing module/action grants; it can never widen what
 * a role can do, only which ProductionStage(s) it can do it on. Blocking it
 * on the seeded PRODUCTION_SUPERVISOR/PRODUCTION_MANAGER roles would force
 * every company wanting a stage-scoped "Cutting Supervisor" to first clone a
 * brand-new custom role just to reach this control, for no safety benefit.
 */
export async function updateRoleProductionStages(actor: ActorContext, roleId: string, input: UpdateRoleProductionStagesInput) {
  const role = await RoleAdminRepository.findById(actor.companyId, roleId);
  if (!role) throw new BusinessRuleError("NOT_FOUND", "Role not found.", { id: roleId });

  const activeStages = await RoleAdminRepository.findActiveProductionStages(actor.companyId);
  const activeStageIds = new Set(activeStages.map((s) => s.id));
  const unknownIds = input.stageIds.filter((id) => !activeStageIds.has(id));
  if (unknownIds.length > 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Unknown or inactive production stage id(s): ${unknownIds.join(", ")}`, { unknownIds });
  }

  await RoleAdminRepository.replaceStageAccessInTx(roleId, input.stageIds);

  // Same reasoning as updateRolePermissions()'s own invalidate() call —
  // every currently-cached user carrying this role would otherwise keep
  // seeing the pre-edit stage set until their cache entry happens to expire.
  // getAllowedProductionStageIds() isn't itself cached, but PermissionService's
  // per-user permission-key cache is invalidated identically here for
  // consistency with every other role-mutation in this file.
  PermissionService.invalidate();

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "role_production_stage_access",
    recordId: roleId,
    action: "UPDATE",
    newValues: { roleId, stageIds: input.stageIds },
  });

  return getRoleProductionStageAccess(actor.companyId, roleId);
}
