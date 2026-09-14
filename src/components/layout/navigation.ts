/**
 * Central sidebar navigation config — single source of truth for every
 * route/label pair the Sidebar renders. Grouping here reflects each route's
 * real backend module ownership (confirmed via the PermissionService.assert
 * module string in its own API route), not just visual/naming intuition —
 * see the sidebar-reorganization report for the evidence behind each
 * placement.
 *
 * A section with no `children` renders as a plain direct link. A section
 * with `children` renders as an expandable group; give it an `href` too when
 * the module has its own landing page (e.g. a dashboard), otherwise the
 * group label is a pure toggle with no page of its own.
 *
 * Every leaf/section also declares its own `modules` — the RBAC module(s)
 * that gate its visibility (shown if the viewer holds `view` on ANY one of
 * them). This is what makes the sidebar actually reflect a role's real
 * permissions instead of showing every link to every logged-in user
 * regardless of what they can do — see filterNavSections() below and
 * PermissionService.getViewableModules().
 */

import type { Module } from "@/config/rbac";

export interface NavLeaf {
  label: string;
  href: string;
  modules: Module[];
}

export interface NavSection {
  label: string;
  href?: string;
  modules: Module[];
  children?: NavLeaf[];
}

export const NAV_SECTIONS: NavSection[] = [
  { label: "Dashboard", href: "/dashboard", modules: ["dashboard"] },
  {
    label: "AI Garment Flow",
    href: "/ai-garment-flow",
    modules: ["ai_garment_flow"],
    children: [
      { label: "Dashboard", href: "/ai-garment-flow", modules: ["ai_garment_flow"] },
      { label: "New Project", href: "/ai-garment-flow/projects/new", modules: ["ai_garment_flow"] },
      { label: "Projects", href: "/ai-garment-flow/projects", modules: ["ai_garment_flow"] },
    ],
  },
  // A genuinely separate module from "AI Garment Flow" above (confirmed
  // explicitly with the user, 2026-09-10) -- its own ai_-prefixed schema, own
  // APIs, own permission module, zero shared business logic.
  {
    label: "AI Designer",
    href: "/ai-designer",
    modules: ["ai_designer"],
    children: [
      { label: "Dashboard", href: "/ai-designer", modules: ["ai_designer"] },
      { label: "Catalogue Designs", href: "/ai-designer/projects", modules: ["ai_designer"] },
      { label: "Replicate Design", href: "/ai-designer/replicate", modules: ["ai_designer"] },
    ],
  },
  { label: "Masters", href: "/masters", modules: ["masters_core", "masters_finance"] },
  {
    label: "CRM",
    href: "/crm",
    modules: ["crm"],
    children: [
      { label: "Leads", href: "/leads", modules: ["crm"] },
      { label: "Deals", href: "/deals", modules: ["crm"] },
      { label: "Follow-ups", href: "/follow-ups", modules: ["crm"] },
      { label: "Import History", href: "/imports", modules: ["crm", "marketing"] },
    ],
  },
  {
    label: "Marketing",
    href: "/marketing",
    modules: ["marketing"],
    children: [{ label: "Campaigns", href: "/campaigns", modules: ["marketing"] }],
  },
  {
    label: "HRMS",
    modules: ["hrms_attendance", "hrms_leave"],
    children: [
      { label: "Attendance", href: "/attendance", modules: ["hrms_attendance"] },
      { label: "Attendance Corrections", href: "/attendance-corrections", modules: ["hrms_attendance"] },
      { label: "Leave Requests", href: "/leave-requests", modules: ["hrms_leave"] },
      { label: "Leave Types", href: "/leave-types", modules: ["hrms_leave"] },
    ],
  },
  {
    label: "Merchandising",
    modules: ["buyer_enquiries", "sampling"],
    children: [
      { label: "Buyer Enquiries", href: "/buyer-enquiries", modules: ["buyer_enquiries"] },
      { label: "Sampling", href: "/sampling", modules: ["sampling"] },
    ],
  },
  {
    label: "Sales",
    modules: ["sales_orders"],
    children: [{ label: "Sales Orders", href: "/sales-orders", modules: ["sales_orders"] }],
  },
  {
    label: "Purchase",
    modules: ["purchasing"],
    children: [
      { label: "Purchase Orders", href: "/purchase-orders", modules: ["purchasing"] },
      { label: "Goods Receipts", href: "/goods-receipts", modules: ["purchasing"] },
    ],
  },
  {
    label: "Manufacturing",
    modules: ["bom_mrp", "production"],
    children: [
      { label: "BOM / MRP", href: "/bom-mrp", modules: ["bom_mrp"] },
      { label: "Production", href: "/production-orders", modules: ["production"] },
      { label: "Job Work Orders", href: "/production/job-work", modules: ["production"] },
      { label: "My Work", href: "/production/my-work", modules: ["production"] },
      { label: "Pending Approvals", href: "/production/approvals", modules: ["production"] },
    ],
  },
  {
    label: "Inventory",
    modules: ["inventory"],
    children: [
      { label: "Stock Balances", href: "/inventory/stock-balances", modules: ["inventory"] },
      { label: "Stock Movements", href: "/inventory/stock-movements", modules: ["inventory"] },
      { label: "Material Requests", href: "/material-requests", modules: ["inventory"] },
    ],
  },
  { label: "Accounts", href: "/accounts", modules: ["accounts", "invoices", "payments", "expenses", "financial_reports"] },
  { label: "Dispatch", href: "/dispatch", modules: ["dispatch"] },
  { label: "Reports", href: "/reports", modules: ["reports"] },
  { label: "Administration", href: "/admin", modules: ["administration"] },
];

function isPathActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** True if this section's own href, or any child's href, matches the current path. */
export function isSectionActive(section: NavSection, pathname: string): boolean {
  if (section.href && isPathActive(pathname, section.href)) return true;
  return section.children?.some((child) => isPathActive(pathname, child.href)) ?? false;
}

/**
 * `viewableModules` is either every module ("all" — a platform admin, or
 * PermissionService.getViewableModules()'s own "all" case) or the real,
 * live-computed list of modules the current user holds `view` on. Deliberately
 * a plain array, not a Set — this value is computed server-side
 * (DashboardLayout) and passed as a prop into the Client Component Sidebar,
 * and this codebase already has one documented RSC-boundary serialization
 * gotcha (Decimal/Date needing JSON.parse(JSON.stringify(...))); a plain
 * array sidesteps that class of surprise entirely rather than relying on
 * React Flight's Set support.
 *
 * A section survives if the viewer can see it directly OR at least one of
 * its children — so e.g. "Manufacturing" still shows for a user who only
 * has `production` and not `bom_mrp`, just with the BOM/MRP leaf hidden.
 */
export function filterNavSections(sections: NavSection[], viewableModules: Module[] | "all"): NavSection[] {
  const viewableSet = viewableModules === "all" ? "all" : new Set(viewableModules);
  const canView = (modules: Module[]) => viewableSet === "all" || modules.some((m) => viewableSet.has(m));

  return sections.reduce<NavSection[]>((acc, section) => {
    const visibleChildren = section.children?.filter((child) => canView(child.modules));
    const sectionItselfVisible = canView(section.modules);

    if (section.children) {
      if (sectionItselfVisible || (visibleChildren && visibleChildren.length > 0)) {
        acc.push({ ...section, children: visibleChildren });
      }
    } else if (sectionItselfVisible) {
      acc.push(section);
    }
    return acc;
  }, []);
}

export { isPathActive };
