import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";

/** Integration screens need `sales_integrations.view` (Phase 16). */
export default async function Layout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id || !(await PermissionService.can(session.user.id, "sales_integrations", "view"))) notFound();
  return <>{children}</>;
}
