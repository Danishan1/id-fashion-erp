import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { RoleAdminRepository } from "./role-admin.repository";
import type { CreateRoleInput, UpdateRoleBranchesInput, UpdateRoleProductionStagesInput } from "./role-admin.schema";

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
 * Purely a display-gate helper for the Permission Matrix page (2026-09-25)
 * — whether the CURRENT viewer holds this exact role themselves, so the UI
 * can render it read-only instead of showing editable controls that would
 * just 403 on save. Real enforcement is the identical check inside
 * updateRolePermissions() itself.
 */
export async function actorHoldsRole(userId: string, roleId: string): Promise<boolean> {
  return RoleAdminRepository.actorHoldsRole(userId, roleId);
}

/**
 * Editing a role's own permission matrix (2026-09-25, revised from the
 * original "no system role, ever" blanket block) — now allowed for any
 * role INCLUDING seeded/system ones (MANAGEMENT, SAMPLING_MANAGER, ...),
 * gated by two real, independent guards instead of one blunt one:
 *
 *  1. SUPER_ADMIN's own row is always protected, for everyone, including
 *     whoever currently holds SUPER_ADMIN themselves — its real access is
 *     the wildcard grant in rbac.ts (SUPER_ADMIN: Object.fromEntries(...)),
 *     never actually read from this table, so editing it here would be
 *     meaningless at best and a genuine lockout risk at worst.
 *  2. Self-escalation guard — a user can never edit the permission matrix
 *     of a role they themselves currently hold, custom roles included.
 *     Same "no self-approval" principle this app already applies to
 *     Sample/Purchase Order/Journal approvals, applied here to prevent a
 *     user from silently widening their own effective access.
 */
export async function updateRolePermissions(actor: ActorContext, roleId: string, grantedKeys: string[]) {
  const role = await RoleAdminRepository.findById(actor.companyId, roleId);
  if (!role) throw new BusinessRuleError("NOT_FOUND", "Role not found.", { id: roleId });

  assertNotSuperAdminRole(role.name, "permission matrix");

  const actorHoldsThisRole = await RoleAdminRepository.actorHoldsRole(actor.userId, roleId);
  if (actorHoldsThisRole) {
    throw new BusinessRuleError(
      "PERMISSION_DENIED",
      `You hold the "${role.name}" role yourself — you cannot edit its own permission matrix.`,
      { roleId, roleName: role.name }
    );
  }

  const catalog = await RoleAdminRepository.findPermissionCatalog();
  const catalogByKey = new Map(catalog.map((p) => [p.key, p.id]));

  const unknownKeys = grantedKeys.filter((k) => !catalogByKey.has(k));
  if (unknownKeys.length > 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Unknown permission key(s): ${unknownKeys.join(", ")}`, { unknownKeys });
  }

  // Captured before the write so the audit log records a real before/after
  // diff, not just the new state (2026-09-25 — a change this sensitive
  // deserves a genuine change log, not just "here's what it became").
  const catalogById = new Map(catalog.map((p) => [p.id, p.key]));
  const previousGranted = await RoleAdminRepository.findGrantedPermissionIds(roleId);
  const previousGrantedKeys = previousGranted
    .map((g) => catalogById.get(g.permissionId))
    .filter((k): k is string => !!k);

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
    oldValues: { roleId, roleName: role.name, grantedKeys: previousGrantedKeys },
    newValues: { roleId, roleName: role.name, grantedKeys },
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
 * SUPER_ADMIN is the one role name deliberately exempt from branch/stage
 * restriction (2026-09-24) — unlike updateRolePermissions()'s isSystemRole
 * block (which SUPER_ADMIN shares with every other seeded role), this is a
 * SUPER_ADMIN-specific carve-out: restricting any OTHER seeded role's
 * branch/stage access is the intentional, useful feature described below,
 * but SUPER_ADMIN exists specifically to be the one role that always has
 * full, unrestricted access — narrowing it would silently lock out whoever
 * holds it (a company's real Super Admin is not always flagged
 * `isPlatformAdmin`, which is the only thing that would otherwise bypass a
 * restriction; see getAllowedBranchIds/getAllowedProductionStageIds).
 */
function assertNotSuperAdminRole(roleName: string, kind: "branch" | "production stage" | "permission matrix") {
  if (roleName === "SUPER_ADMIN") {
    throw new BusinessRuleError(
      "REFERENCED_RECORD_IN_USE",
      kind === "permission matrix"
        ? "SUPER_ADMIN must always have full, unrestricted access — its permission matrix can never be edited by anyone."
        : `SUPER_ADMIN must always have unrestricted access — its ${kind} access cannot be restricted.`,
      { roleName }
    );
  }
}

/**
 * Deliberately allowed on every OTHER system role — unlike
 * updateRolePermissions() above. Stage restriction is a purely
 * additive/narrowing dimension layered on top of a role's existing
 * module/action grants; it can never widen what a role can do, only which
 * ProductionStage(s) it can do it on. Blocking it on the seeded
 * PRODUCTION_SUPERVISOR/PRODUCTION_MANAGER roles would force every company
 * wanting a stage-scoped "Cutting Supervisor" to first clone a brand-new
 * custom role just to reach this control, for no safety benefit. SUPER_ADMIN
 * itself is the one exception — see assertNotSuperAdminRole() above.
 */
export async function updateRoleProductionStages(actor: ActorContext, roleId: string, input: UpdateRoleProductionStagesInput) {
  const role = await RoleAdminRepository.findById(actor.companyId, roleId);
  if (!role) throw new BusinessRuleError("NOT_FOUND", "Role not found.", { id: roleId });
  assertNotSuperAdminRole(role.name, "production stage");

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

export async function getRoleBranchAccess(companyId: string, roleId: string) {
  const role = await RoleAdminRepository.findById(companyId, roleId);
  if (!role) throw new BusinessRuleError("NOT_FOUND", "Role not found.", { id: roleId });

  const [branches, granted] = await Promise.all([
    RoleAdminRepository.findActiveBranches(companyId),
    RoleAdminRepository.findGrantedBranchIds(roleId),
  ]);
  const grantedIds = new Set(granted.map((g) => g.branchId));

  return {
    role: { id: role.id, name: role.name },
    // Zero rows granted = unrestricted (every branch) — surfaced explicitly
    // here rather than left for the UI to infer, same reasoning as
    // getRoleProductionStageAccess()'s own isRestricted flag.
    isRestricted: grantedIds.size > 0,
    branches: branches.map((b) => ({ id: b.id, name: b.name, code: b.code, granted: grantedIds.has(b.id) })),
  };
}

/**
 * Deliberately allowed on every OTHER system role — identical reasoning to
 * updateRoleProductionStages() above: branch restriction is a purely
 * additive/narrowing dimension layered on top of a role's existing
 * module/action grants, never widening what it can do, only which
 * branch(es) it can do it on. SUPER_ADMIN itself is the one exception — see
 * assertNotSuperAdminRole() above.
 */
export async function updateRoleBranches(actor: ActorContext, roleId: string, input: UpdateRoleBranchesInput) {
  const role = await RoleAdminRepository.findById(actor.companyId, roleId);
  if (!role) throw new BusinessRuleError("NOT_FOUND", "Role not found.", { id: roleId });
  assertNotSuperAdminRole(role.name, "branch");

  const activeBranches = await RoleAdminRepository.findActiveBranches(actor.companyId);
  const activeBranchIds = new Set(activeBranches.map((b) => b.id));
  const unknownIds = input.branchIds.filter((id) => !activeBranchIds.has(id));
  if (unknownIds.length > 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Unknown or inactive branch id(s): ${unknownIds.join(", ")}`, { unknownIds });
  }

  await RoleAdminRepository.replaceBranchAccessInTx(roleId, input.branchIds);

  // Same reasoning as updateRoleProductionStages()'s own invalidate() call.
  PermissionService.invalidate();

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "role_branch_access",
    recordId: roleId,
    action: "UPDATE",
    newValues: { roleId, branchIds: input.branchIds },
  });

  return getRoleBranchAccess(actor.companyId, roleId);
}
