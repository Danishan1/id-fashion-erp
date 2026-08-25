import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listUsers } from "@/modules/administration/user-admin.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { AdminUsersPanel } from "./AdminUsersPanel";

export default async function AdministrationPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "administration", "view").catch(() => notFound());

  const users = await listUsers(session!.user.companyId);
  const canManage = await PermissionService.can(session!.user.id, "administration", "create");

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Administration" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Administration — Users</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Create additional users and assign them a branch + role, so the RBAC permission matrix can actually
          be exercised by more than the one seeded Super Admin account.
        </p>
      </div>
      <AdminUsersPanel initialUsers={JSON.parse(JSON.stringify(users))} canManage={canManage} currentUserId={session!.user.id} />
    </div>
  );
}
