import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";

/**
 * Every /sales-marketing page requires view on one of the module's permission
 * modules (`sales_marketing` or `sales_quotations`); each area's own layout or
 * page then checks its own module (same notFound() convention as every other
 * module). Actions inside pages are still checked by their own API routes.
 */
export default async function SalesMarketingLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) notFound();
  await PermissionService.assertAny(
    session.user.id,
    [
      ["sales_marketing", "view"],
      ["sales_quotations", "view"],
    ],
    { sessionIssuedAt: session.user.sessionIssuedAt }
  ).catch(() => notFound());
  return <div className="space-y-6">{children}</div>;
}
