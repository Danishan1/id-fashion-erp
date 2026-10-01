import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";

/**
 * Every /crm page requires the ERP permission `crm.view` (same notFound()
 * convention as every other module page). Individual actions inside pages are
 * still checked by their API routes.
 */
export default async function CrmLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) notFound();
  await PermissionService.assert(session.user.id, "crm", "view", { sessionIssuedAt: session.user.sessionIssuedAt }).catch(() => notFound());
  return <div className="space-y-6">{children}</div>;
}
