import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";

/** Quotations need `sales_quotations.view` (Release 1 / S2). */
export default async function QuotationsLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) notFound();
  if (!(await PermissionService.can(session.user.id, "sales_quotations", "view"))) notFound();
  return <>{children}</>;
}
