import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";

/** Analytics screens need `sales_analytics.view` (Phase 17); every metric still needs its source module. */
export default async function Layout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id || !(await PermissionService.can(session.user.id, "sales_analytics", "view"))) notFound();
  return <>{children}</>;
}
