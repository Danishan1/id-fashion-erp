import type { ReactNode } from "react";
import { auth } from "@/core/auth/auth";
import type { Module, Action } from "@/config/rbac";
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

  // "Pending Approvals" needs production.approve specifically, not just
  // production.view — see navigation.ts's `requiredAction` field. "Scanner"
  // (Barcode Management & Scanning System, 2026-09-29) needs barcodes.scan
  // specifically, not just barcodes.view (a role can hold view-only
  // oversight of the barcode registry without holding scan itself, e.g.
  // MANAGEMENT).
  const [approveModulesResult, scanModulesResult] = session?.user?.id
    ? await Promise.all([
        PermissionService.getModulesWithAction(session.user.id, "approve"),
        PermissionService.getModulesWithAction(session.user.id, "scan"),
      ])
    : [new Set<Module>(), new Set<Module>()];
  const actionModules: Partial<Record<Action, Module[] | "all">> = {
    approve: approveModulesResult === "all" ? "all" : Array.from(approveModulesResult),
    scan: scanModulesResult === "all" ? "all" : Array.from(scanModulesResult),
  };

  return (
    <DashboardShell
      isPlatformAdmin={session?.user?.isPlatformAdmin}
      viewableModules={viewableModules}
      actionModules={actionModules}
      userName={session?.user?.name ?? session?.user?.email ?? "User"}
    >
      {children}
    </DashboardShell>
  );
}
