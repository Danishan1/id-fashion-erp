import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getRolePermissionMatrix, getRoleProductionStageAccess, getRoleBranchAccess, actorHoldsRole } from "@/modules/administration/role-admin.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { RolePermissionMatrix } from "./RolePermissionMatrix";
import { RoleProductionStageAccessPanel } from "./RoleProductionStageAccessPanel";
import { RoleBranchAccessPanel } from "./RoleBranchAccessPanel";

export default async function RolePermissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "administration_roles", "view", { sessionIssuedAt: session!.user.sessionIssuedAt }).catch(() =>
    notFound()
  );

  const { id } = await params;
  const [matrix, stageAccess, branchAccess] = await Promise.all([
    getRolePermissionMatrix(session!.user.companyId, id).catch(() => notFound()),
    getRoleProductionStageAccess(session!.user.companyId, id).catch(() => null),
    getRoleBranchAccess(session!.user.companyId, id).catch(() => null),
  ]);
  const canManage = await PermissionService.can(session!.user.id, "administration_roles", "edit");
  // SUPER_ADMIN must always have full, unrestricted access — its branch/
  // production-stage scope can never be narrowed, unlike every other system
  // role's (2026-09-24). Purely a display convenience mirroring the real
  // backend guard in assertNotSuperAdminRole(); the panels below stay
  // visible (so it's clear the role is genuinely unrestricted, not just
  // hidden) but render read-only.
  const isSuperAdminRole = matrix.role.name === "SUPER_ADMIN";
  const canManageScope = canManage && !isSuperAdminRole;
  // Permission-matrix editing overhaul (2026-09-25): every system role is
  // now genuinely editable (not just SUPER_ADMIN-locked) — EXCEPT that no
  // one can ever edit SUPER_ADMIN's own row, and no one can edit the
  // permission matrix of a role they themselves currently hold (a
  // self-escalation guard, mirroring the real, authoritative check inside
  // updateRolePermissions() itself). This is a display convenience only —
  // the service re-asserts both locks server-side regardless of what this
  // page renders.
  const actorHoldsThisRole = await actorHoldsRole(session!.user.id, id);
  const canEditPermissionMatrix = canManage && !isSuperAdminRole && !actorHoldsThisRole;

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Administration", href: "/admin" }, { label: matrix.role.name }]}
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{matrix.role.name} — Permissions</h1>
        {matrix.role.description && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{matrix.role.description}</p>}
        {isSuperAdminRole && (
          <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
            SUPER_ADMIN always has full, unrestricted access — its permission matrix, branch, and
            production-stage scope below can never be edited or narrowed by anyone, including other Super
            Admins.
          </p>
        )}
        {!isSuperAdminRole && actorHoldsThisRole && (
          <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
            You hold the &quot;{matrix.role.name}&quot; role yourself — to prevent self-escalation, you
            cannot edit its own permission matrix. Ask another Admin or Super Admin who doesn&apos;t hold
            this role to make the change.
          </p>
        )}
        {!isSuperAdminRole && !actorHoldsThisRole && matrix.role.isSystemRole && (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            This is a seeded system role — its permissions can be edited like any custom role.
          </p>
        )}
      </div>
      <RolePermissionMatrix roleId={id} initialCatalog={matrix.catalog} canManage={canEditPermissionMatrix} />
      {stageAccess && stageAccess.stages.length > 0 && (
        <RoleProductionStageAccessPanel roleId={id} initialAccess={stageAccess} canManage={canManageScope} />
      )}
      {branchAccess && branchAccess.branches.length > 0 && (
        <RoleBranchAccessPanel roleId={id} initialAccess={branchAccess} canManage={canManageScope} />
      )}
    </div>
  );
}
