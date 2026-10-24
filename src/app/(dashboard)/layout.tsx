import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { prisma } from "@/core/db/client";
import type { Module, Action } from "@/config/rbac";
import { PermissionService } from "@/core/rbac/PermissionService";
import { DashboardShell } from "@/components/layout/DashboardShell";
import Link from "next/link";
import { SupportSessionBanner } from "@/components/support/SupportSessionBanner";
import { countPendingSupportItems } from "@/modules/support-access/support-access.service";
import { SubscriptionBanner } from "@/components/layout/SubscriptionBanner";
import { computeSubscriptionStatus } from "@/core/subscriptions/subscription-state";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  // PLAT-006: a suspended company's users get only the suspended notice —
  // never the ERP. This is a redirect, not a different component: the layout
  // and the page render in parallel, so returning other JSX here would still
  // stream the page's own data. The redirect aborts the whole render. API
  // routes refuse them independently (requireSession()). The middleware
  // already keeps platform sessions out of this route group.
  let subscriptionBanner: ReactNode = null;
  if (session?.user?.id) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        company: {
          select: { isActive: true, subscription: { select: { isTrial: true, currentPeriodEndsAt: true } } },
        },
      },
    });
    if (user && !user.company.isActive) redirect("/account-suspended");
    // Phase 4: trial ending / grace period / read-only archive notice.
    subscriptionBanner = <SubscriptionBanner status={computeSubscriptionStatus(user?.company.subscription)} />;
  }

  // Computed here (Server Component) rather than fetched client-side, so the
  // sidebar renders correctly-scoped on the very first paint instead of
  // flashing every link before a client fetch resolves.
  const viewableModules: Module[] = session?.user?.id
    ? Array.from(await PermissionService.getViewableModules(session.user.id))
    : [];

  // "Pending Approvals" needs production.approve specifically, not just
  // production.view — see navigation.ts's `requiredAction` field. "Scanner"
  // (Barcode Management & Scanning System, 2026-09-29) needs barcodes.scan
  // specifically, not just barcodes.view (a role can hold view-only
  // oversight of the barcode registry without holding scan itself, e.g.
  // MANAGEMENT).
  // "edit" / "export" gate the Attendance Settings and Salary Sheet links.
  const [approveModules, scanModules, editModules, exportModules] = session?.user?.id
    ? await Promise.all([
        PermissionService.getModulesWithAction(session.user.id, "approve"),
        PermissionService.getModulesWithAction(session.user.id, "scan"),
        PermissionService.getModulesWithAction(session.user.id, "edit"),
        PermissionService.getModulesWithAction(session.user.id, "export"),
      ])
    : [new Set<Module>(), new Set<Module>(), new Set<Module>(), new Set<Module>()];
  const actionModules: Partial<Record<Action, Module[]>> = {
    approve: Array.from(approveModules),
    scan: Array.from(scanModules),
    edit: Array.from(editModules),
    export: Array.from(exportModules),
  };

  // Phase 2: a support session always shows its banner; a company's Super
  // Admin sees a notice while a support request is waiting for them.
  let topBanner: ReactNode = null;
  if (session?.user?.userType === "SUPPORT") {
    topBanner = <SupportSessionBanner />;
  } else if (session?.user?.id) {
    const pending = await countPendingSupportItems({ userId: session.user.id, companyId: session.user.companyId });
    if (pending > 0) {
      topBanner = (
        <Link
          href="/admin/support-access"
          className="block bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          {pending === 1 ? "A support access request is" : `${pending} support access requests are`} waiting for your
          approval — review
        </Link>
      );
    }
  }

  return (
    <DashboardShell
      viewableModules={viewableModules}
      actionModules={actionModules}
      userName={session?.user?.name ?? session?.user?.email ?? "User"}
      topBanner={
        <>
          {subscriptionBanner}
          {topBanner}
        </>
      }
    >
      {children}
    </DashboardShell>
  );
}
