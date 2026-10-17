import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listUsers } from "@/modules/administration/user-admin.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { AdminTabs } from "./AdminTabs";
import Link from "next/link";
import { isCompanySupportAdmin } from "@/modules/support-access/support-access.service";

export default async function AdministrationPage() {
  const session = await auth();
  const userId = session!.user.id;
  const resourceContext = { sessionIssuedAt: session!.user.sessionIssuedAt };

  // The page-level gate is deliberately an OR across all 3 granular
  // Administration modules (RBAC audit, 2026-09-24 split) — the page is the
  // shared entry point for Users/Roles/Settings, and each tab below is then
  // independently re-gated on its own specific module, so a viewer who only
  // holds one of the three still reaches the page but only ever sees (and
  // only ever has fetched on their behalf) the tab(s) they actually hold.
  const [canViewUsers, canManageUsers, canViewRoles, canManageRoles, canViewSettings, canManageSettings] =
    await Promise.all([
      PermissionService.can(userId, "administration_users", "view", resourceContext),
      PermissionService.can(userId, "administration_users", "create", resourceContext),
      PermissionService.can(userId, "administration_roles", "view", resourceContext),
      PermissionService.can(userId, "administration_roles", "create", resourceContext),
      PermissionService.can(userId, "administration_settings", "view", resourceContext),
      PermissionService.can(userId, "administration_settings", "create", resourceContext),
    ]);
  if (!canViewUsers && !canViewRoles && !canViewSettings) notFound();

  // Only ever fetched (and therefore only ever present in this page's own
  // server-rendered payload) when the viewer genuinely holds
  // administration_users.view — previously this ran unconditionally for
  // anyone who passed the single old "administration.view" gate, meaning
  // e.g. ACCOUNTS_MANAGER's page payload always contained the full company
  // User list (with emails) even though their own grant was only ever meant
  // to cover Settings (RBAC_AUDIT_REPORT.md, finding G/D).
  const users = canViewUsers ? await listUsers(session!.user.companyId) : [];
  // Platform SaaS Phase 2 — only the company's own Super Admin manages support access.
  const isSupportAdmin = await isCompanySupportAdmin({ userId, companyId: session!.user.companyId });

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Administration" }]} />
      <div>
        {isSupportAdmin && (
          <Link
            href="/admin/support-access"
            className="float-right rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Support Access
          </Link>
        )}
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Administration</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Users, branches, roles &amp; permissions, company settings, document numbering, and the full audit trail of who
          changed what, and when, across every module.
        </p>
      </div>
      <AdminTabs
        initialUsers={JSON.parse(JSON.stringify(users))}
        currentUserId={session!.user.id}
        access={{
          users: { view: canViewUsers, manage: canManageUsers },
          roles: { view: canViewRoles, manage: canManageRoles },
          settings: { view: canViewSettings, manage: canManageSettings },
        }}
      />
    </div>
  );
}
