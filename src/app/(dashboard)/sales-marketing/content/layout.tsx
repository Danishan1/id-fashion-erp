import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";

/** Content library screens need `marketing_content.view` (Phase 11). */
export default async function Layout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id || !(await PermissionService.can(session.user.id, "marketing_content", "view"))) notFound();
  return <>{children}</>;
}
