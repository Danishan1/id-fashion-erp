import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";

/** Attribution screens need `marketing_attribution.view` (Phase 13). */
export default async function Layout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id || !(await PermissionService.can(session.user.id, "marketing_attribution", "view"))) notFound();
  return <>{children}</>;
}
