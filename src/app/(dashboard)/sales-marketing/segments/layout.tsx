import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";

/** Audience segment screens need `marketing_segments.view` (Phase 09). */
export default async function Layout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id || !(await PermissionService.can(session.user.id, "marketing_segments", "view"))) notFound();
  return <>{children}</>;
}
