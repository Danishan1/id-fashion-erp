import type { Module } from "@/config/rbac";
import { prisma } from "@/core/db/client";
import { PermissionService } from "@/core/rbac/PermissionService";
import { branchScopeWhere } from "@/lib/branch-access";
import { SALES_MARKETING_SECTIONS, type SalesMarketingSection } from "./sales-marketing-sections";

/**
 * Sales & Marketing dashboard data (Phase 01).
 *
 * Phase 01 has no Sales & Marketing records of its own yet, so it returns no
 * sales or marketing KPIs at all — never placeholder numbers. It returns:
 *  - the module map (which sections exist and which phase builds the rest);
 *  - real counts from existing ERP modules this module will build on, each
 *    only when the viewer can view that module, using the same rules as that
 *    module's own list page (Sales Orders are branch-scoped, like its list).
 */

export interface SalesMarketingActor {
  companyId: string;
  userId: string;
}

export interface ConnectedSource {
  key: "customers" | "buyerEnquiries" | "salesOrders" | "crm";
  label: string;
  description: string;
  href: string;
  /** Real figures; empty for a source that is linked but not counted here. */
  metrics: { label: string; value: number }[];
}

export interface SalesMarketingOverview {
  sections: SalesMarketingSection[];
  connectedSources: ConnectedSource[];
}

/** Open = still being worked: confirmed and not yet fully shipped. */
const OPEN_SALES_ORDER_STATUSES = ["CONFIRMED", "IN_PRODUCTION", "PARTIALLY_DISPATCHED"] as const;

export async function getSalesMarketingOverview(actor: SalesMarketingActor): Promise<SalesMarketingOverview> {
  const viewable = await PermissionService.getViewableModules(actor.userId);
  const can = (module: Module) => viewable.has(module);

  const tasks: Promise<ConnectedSource>[] = [];

  if (can("masters_core")) {
    tasks.push(
      prisma.customer
        .count({ where: { companyId: actor.companyId, isActive: true, deletedAt: null } })
        .then((active) => ({
          key: "customers" as const,
          label: "Customers",
          description: "The ERP customer master. Quotations and campaigns will use it, never a copy.",
          href: "/masters/customers",
          metrics: [{ label: "Active customers", value: active }],
        }))
    );
  }

  if (can("buyer_enquiries")) {
    tasks.push(
      prisma.buyerEnquiry
        .count({ where: { companyId: actor.companyId, status: { in: ["OPEN", "PARTIALLY_CONVERTED"] } } })
        .then((open) => ({
          key: "buyerEnquiries" as const,
          label: "Buyer Enquiries",
          description: "Existing merchandising enquiries. Phase 02 decides how Sales Enquiries relate to them.",
          href: "/buyer-enquiries",
          metrics: [{ label: "Open enquiries", value: open }],
        }))
    );
  }

  if (can("sales_orders")) {
    tasks.push(
      (async () => {
        const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
        const scope = { companyId: actor.companyId, ...branchScopeWhere(allowedBranchIds) };
        const [draft, open] = await Promise.all([
          prisma.salesOrder.count({ where: { ...scope, status: "DRAFT" } }),
          prisma.salesOrder.count({ where: { ...scope, status: { in: [...OPEN_SALES_ORDER_STATUSES] } } }),
        ]);
        return {
          key: "salesOrders" as const,
          label: "Sales Orders",
          description: "The existing order module. Accepted quotations will become Sales Orders here (Phase 04).",
          href: "/sales-orders",
          metrics: [
            { label: "Draft", value: draft },
            { label: "Confirmed, not yet shipped", value: open },
          ],
        };
      })()
    );
  }

  if (can("crm")) {
    tasks.push(
      Promise.resolve({
        key: "crm" as const,
        label: "CRM",
        description: "Leads, contacts, companies and opportunities stay in the CRM; Sales & Marketing links to them.",
        href: "/crm",
        metrics: [],
      })
    );
  }

  return { sections: [...SALES_MARKETING_SECTIONS], connectedSources: await Promise.all(tasks) };
}
