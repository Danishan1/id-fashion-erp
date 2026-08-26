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
 */

export interface NavLeaf {
  label: string;
  href: string;
}

export interface NavSection {
  label: string;
  href?: string;
  children?: NavLeaf[];
}

export const NAV_SECTIONS: NavSection[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Masters", href: "/masters" },
  {
    label: "CRM",
    href: "/crm",
    children: [
      { label: "Leads", href: "/leads" },
      { label: "Deals", href: "/deals" },
      { label: "Follow-ups", href: "/follow-ups" },
      { label: "Import History", href: "/imports" },
    ],
  },
  {
    label: "Marketing",
    href: "/marketing",
    children: [{ label: "Campaigns", href: "/campaigns" }],
  },
  {
    label: "HRMS",
    children: [
      { label: "Attendance", href: "/attendance" },
      { label: "Attendance Corrections", href: "/attendance-corrections" },
      { label: "Leave Requests", href: "/leave-requests" },
      { label: "Leave Types", href: "/leave-types" },
    ],
  },
  {
    label: "Merchandising",
    children: [
      { label: "Buyer Enquiries", href: "/buyer-enquiries" },
      { label: "Sampling", href: "/sampling" },
    ],
  },
  {
    label: "Sales",
    children: [{ label: "Sales Orders", href: "/sales-orders" }],
  },
  {
    label: "Purchase",
    children: [
      { label: "Purchase Orders", href: "/purchase-orders" },
      { label: "Goods Receipts", href: "/goods-receipts" },
    ],
  },
  {
    label: "Manufacturing",
    children: [
      { label: "BOM / MRP", href: "/bom-mrp" },
      { label: "Production", href: "/production-orders" },
      { label: "Job Work Orders", href: "/production/job-work" },
    ],
  },
  {
    label: "Inventory",
    children: [
      { label: "Stock Balances", href: "/inventory/stock-balances" },
      { label: "Stock Movements", href: "/inventory/stock-movements" },
      { label: "Material Requests", href: "/material-requests" },
    ],
  },
  { label: "Accounts", href: "/accounts" },
  { label: "Dispatch", href: "/dispatch" },
  { label: "Reports", href: "/reports" },
  { label: "Administration", href: "/admin" },
];

function isPathActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** True if this section's own href, or any child's href, matches the current path. */
export function isSectionActive(section: NavSection, pathname: string): boolean {
  if (section.href && isPathActive(pathname, section.href)) return true;
  return section.children?.some((child) => isPathActive(pathname, child.href)) ?? false;
}

export { isPathActive };
