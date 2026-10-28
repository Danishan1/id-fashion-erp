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
  /** Sales & Marketing itself (dashboard, enquiries). */
  view: boolean;
  quotations: { view: boolean; create: boolean; edit: boolean; cancel: boolean };
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
  const [view, create, edit, viewAll, crmView, crmEdit, merchandisingView, qView, qCreate, qEdit, qCancel] = await Promise.all([
    PermissionService.can(userId, "sales_marketing", "view"),
    PermissionService.can(userId, "sales_marketing", "create"),
    PermissionService.can(userId, "sales_marketing", "edit"),
    PermissionService.can(userId, "sales_marketing", "view_all"),
    PermissionService.can(userId, "crm", "view"),
    PermissionService.can(userId, "crm", "edit"),
    PermissionService.can(userId, "buyer_enquiries", "view"),
    PermissionService.can(userId, "sales_quotations", "view"),
    PermissionService.can(userId, "sales_quotations", "create"),
    PermissionService.can(userId, "sales_quotations", "edit"),
    PermissionService.can(userId, "sales_quotations", "cancel"),
  ]);
  return {
    actor: { companyId: session.user.companyId, userId, branchId: session.user.defaultBranchId ?? null },
    permissions: {
      view,
      create,
      edit,
      viewAll,
      crmView,
      crmEdit,
      merchandisingView,
      quotations: { view: qView, create: qCreate, edit: qEdit, cancel: qCancel },
    },
  };
}
