import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listUsers } from "@/modules/administration/user-admin.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { AdminTabs } from "./AdminTabs";

export default async function AdministrationPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "administration", "view", { sessionIssuedAt: session!.user.sessionIssuedAt }).catch(() => notFound());

  const users = await listUsers(session!.user.companyId);
  const canManage = await PermissionService.can(session!.user.id, "administration", "create");

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Administration" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Administration</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Manage users and review the full audit trail of who changed what, and when, across every module.
        </p>
      </div>
      <AdminTabs initialUsers={JSON.parse(JSON.stringify(users))} canManage={canManage} currentUserId={session!.user.id} />
    </div>
  );
}
