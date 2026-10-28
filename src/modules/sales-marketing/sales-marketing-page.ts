import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalesActor } from "./enquiries/sales-enquiry.service";

export interface SalesMarketingPagePermissions {
  create: boolean;
  edit: boolean;
  viewAll: boolean;
  crmView: boolean;
  crmEdit: boolean;
  /** Merchandising's Buyer Enquiry screen (line review, Sample conversion). */
  merchandisingView: boolean;
}

/**
 * Server-component helper for Sales & Marketing pages: the actor (same shape
 * the API routes build) plus permission flags that only drive the UI — every
 * action is enforced again by its route.
 */
export async function getSalesMarketingPageContext(): Promise<{ actor: SalesActor; permissions: SalesMarketingPagePermissions }> {
  const session = await auth();
  if (!session?.user?.id) notFound();
  const userId = session.user.id;
  const [create, edit, viewAll, crmView, crmEdit, merchandisingView] = await Promise.all([
    PermissionService.can(userId, "sales_marketing", "create"),
    PermissionService.can(userId, "sales_marketing", "edit"),
    PermissionService.can(userId, "sales_marketing", "view_all"),
    PermissionService.can(userId, "crm", "view"),
    PermissionService.can(userId, "crm", "edit"),
    PermissionService.can(userId, "buyer_enquiries", "view"),
  ]);
  return {
    actor: { companyId: session.user.companyId, userId, branchId: session.user.defaultBranchId ?? null },
    permissions: { create, edit, viewAll, crmView, crmEdit, merchandisingView },
  };
}
