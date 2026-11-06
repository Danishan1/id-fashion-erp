import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";

/** Enquiries need `sales_marketing.view` (quotation-only users get 404 here). */
export default async function SalesEnquiriesLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) notFound();
  if (!(await PermissionService.can(session.user.id, "sales_marketing", "view"))) notFound();
  return <>{children}</>;
}
