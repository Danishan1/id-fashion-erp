import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";

/** Pricing screens need `sales_pricing.view` (Phase 03). */
export default async function PricingLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) notFound();
  if (!(await PermissionService.can(session.user.id, "sales_pricing", "view"))) notFound();
  return <>{children}</>;
}
