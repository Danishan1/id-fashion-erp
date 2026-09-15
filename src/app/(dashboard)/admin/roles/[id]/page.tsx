import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getRolePermissionMatrix, getRoleProductionStageAccess, getRoleBranchAccess } from "@/modules/administration/role-admin.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { RolePermissionMatrix } from "./RolePermissionMatrix";
import { RoleProductionStageAccessPanel } from "./RoleProductionStageAccessPanel";
import { RoleBranchAccessPanel } from "./RoleBranchAccessPanel";

export default async function RolePermissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "administration", "view", { sessionIssuedAt: session!.user.sessionIssuedAt }).catch(() =>
    notFound()
  );

  const { id } = await params;
  const [matrix, stageAccess, branchAccess] = await Promise.all([
    getRolePermissionMatrix(session!.user.companyId, id).catch(() => notFound()),
    getRoleProductionStageAccess(session!.user.companyId, id).catch(() => null),
    getRoleBranchAccess(session!.user.companyId, id).catch(() => null),
  ]);
  const canManage = await PermissionService.can(session!.user.id, "administration", "edit");

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Administration", href: "/admin" }, { label: matrix.role.name }]}
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{matrix.role.name} — Permissions</h1>
        {matrix.role.description && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{matrix.role.description}</p>}
        {matrix.role.isSystemRole && (
          <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
            This is a seeded system role — its permissions are read-only here and cannot be edited.
          </p>
        )}
      </div>
      <RolePermissionMatrix
        roleId={id}
        initialCatalog={matrix.catalog}
        isSystemRole={matrix.role.isSystemRole}
        canManage={canManage}
      />
      {stageAccess && stageAccess.stages.length > 0 && (
        <RoleProductionStageAccessPanel roleId={id} initialAccess={stageAccess} canManage={canManage} />
      )}
      {branchAccess && branchAccess.branches.length > 0 && (
        <RoleBranchAccessPanel roleId={id} initialAccess={branchAccess} canManage={canManage} />
      )}
    </div>
  );
}
