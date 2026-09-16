import type { ReactNode } from "react";
import { auth } from "@/core/auth/auth";
import type { Module } from "@/config/rbac";
import { PermissionService } from "@/core/rbac/PermissionService";
import { DashboardShell } from "@/components/layout/DashboardShell";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  // Computed here (Server Component) rather than fetched client-side —
  // matches how isPlatformAdmin is already resolved on this same session,
  // and means the sidebar renders correctly-scoped on the very first paint
  // instead of flashing every link before a client fetch resolves.
  const viewableModulesResult = session?.user?.id
    ? await PermissionService.getViewableModules(session.user.id)
    : new Set<Module>();
  const viewableModules = viewableModulesResult === "all" ? "all" : Array.from(viewableModulesResult);

  return (
    <DashboardShell
      isPlatformAdmin={session?.user?.isPlatformAdmin}
      viewableModules={viewableModules}
      userName={session?.user?.name ?? session?.user?.email ?? "User"}
    >
      {children}
    </DashboardShell>
  );
}
