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

import type { Module, Action } from "@/config/rbac";

export interface NavLeaf {
  label: string;
  href: string;
  modules: Module[];
  /**
   * Defaults to "view" — the action the viewer must hold on ANY of
   * `modules` for this leaf to show. Set to a different action (e.g.
   * "approve") when a leaf's own real page requires more than plain view —
   * see "Pending Approvals" below, added so it stops appearing (and
   * reliably 404ing) for roles that hold production.view but not
   * production.approve (RBAC audit, 2026-09-24).
   */
  requiredAction?: Action;
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
    // Only two entries (2026-09-27). Replicate Design and Sketch to Garment
    // still exist and stay reachable by URL; they are no longer in the sidebar.
    children: [
      { label: "New Design", href: "/ai-designer/new-design", modules: ["ai_designer"] },
      { label: "Catalogue Designs", href: "/ai-designer/catalogue-designs", modules: ["ai_designer"] },
    ],
  },
  { label: "Masters", href: "/masters", modules: ["masters_core", "masters_finance"] },
  // CRM rebuild (2026-10-01, docs/crm/CRM_MASTER_BLUEPRINT.md) — each phase
  // adds its own leaf here when its screens exist; never link unbuilt pages.
  {
    label: "CRM",
    href: "/crm",
    modules: ["crm"],
    children: [
      { label: "Dashboard", href: "/crm", modules: ["crm"] },
      { label: "Leads", href: "/crm/leads", modules: ["crm"] },
      { label: "Import Leads", href: "/crm/leads/import", modules: ["crm"] },
      { label: "Import History", href: "/crm/leads/imports", modules: ["crm"] },
      { label: "Contacts", href: "/crm/contacts", modules: ["crm"] },
      { label: "Companies", href: "/crm/companies", modules: ["crm"] },
      { label: "Opportunities", href: "/crm/opportunities", modules: ["crm"] },
      { label: "Inbox", href: "/crm/inbox", modules: ["crm"] },
      { label: "Templates", href: "/crm/templates", modules: ["crm"] },
      { label: "My Tasks", href: "/crm/my-tasks", modules: ["crm"] },
      { label: "Calendar", href: "/crm/calendar", modules: ["crm"] },
      { label: "Activities", href: "/crm/activities", modules: ["crm"] },

      { label: "Activity Log", href: "/crm/activity", modules: ["crm"] },
      { label: "Settings", href: "/crm/settings", modules: ["crm_settings"] },
    ],
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
    modules: ["purchase_order", "inventory"],
    children: [
      { label: "Purchase Orders", href: "/purchase-orders", modules: ["purchase_order"] },
      // Goods Receipt creation is gated on `inventory`, not `purchase_order`
      // (the dock-receiving persona — WAREHOUSE_USER/STORE_MANAGER — holds
      // inventory:create/edit but not necessarily purchase_order — see the
      // comment on the POST /api/v1/purchase-orders/[id]/receipts route).
      // The nav leaf previously (incorrectly) gated this on "purchasing" —
      // fixed here to match the page's own real permission check (RBAC
      // audit, 2026-09-24).
      { label: "Goods Receipts", href: "/goods-receipts", modules: ["inventory"] },
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
      // Requires production.approve specifically, not just production.view —
      // the page itself gates on approve (it's the Supervisor/Manager
      // approval queue). Previously gated on plain "production" here, so
      // PRODUCTION_WORKER/EXTERNAL_UNIT_USER (production.view only, no
      // approve) saw this link and got a reliable 404 on click; their own
      // submission status already lives on "My Work" above (RBAC audit,
      // 2026-09-24).
      { label: "Pending Approvals", href: "/production/approvals", modules: ["production"], requiredAction: "approve" },
    ],
  },
  {
    label: "Inventory",
    modules: ["inventory", "material_request"],
    children: [
      { label: "Stock Balances", href: "/inventory/stock-balances", modules: ["inventory"] },
      { label: "Stock Movements", href: "/inventory/stock-movements", modules: ["inventory"] },
      // Material Requests moved to its own `material_request` module (RBAC
      // audit, 2026-09-24) — previously gated on the same coarse `inventory`
      // key as Stock Balances/Movements.
      { label: "Material Requests", href: "/material-requests", modules: ["material_request"] },
    ],
  },
  { label: "Accounts", href: "/accounts", modules: ["accounts", "invoices", "payments", "expenses", "financial_reports"] },
  { label: "Dispatch", href: "/dispatch", modules: ["dispatch"] },
  {
    label: "Barcodes",
    modules: ["barcodes"],
    children: [
      { label: "Scanner", href: "/production/scan", modules: ["barcodes"], requiredAction: "scan" },
      { label: "Barcode Management", href: "/barcodes", modules: ["barcodes"] },
    ],
  },
  { label: "Reports", href: "/reports", modules: ["reports"] },
  {
    label: "Administration",
    href: "/admin",
    modules: ["administration_users", "administration_roles", "administration_settings"],
  },
];

function isPathActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * True if this child is the one to highlight. A child whose href is a prefix
 * of a sibling's (e.g. "Dashboard" at /crm next to "Activity Log" at
 * /crm/activity) is only active when no more specific sibling matches, so
 * exactly one leaf is highlighted.
 */
export function isLeafActive(siblings: NavLeaf[], child: NavLeaf, pathname: string): boolean {
  if (!isPathActive(pathname, child.href)) return false;
  return !siblings.some(
    (other) => other.href !== child.href && other.href.length > child.href.length && isPathActive(pathname, other.href)
  );
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
 *
 * `actionModules` carries the equivalent module-set for any non-"view"
 * action a leaf might declare via `requiredAction` (e.g. `{ approve: [...] }`
 * for "Pending Approvals") — computed server-side the same way
 * `viewableModules` is, via `PermissionService.getModulesWithAction()`.
 * Leaves that don't set `requiredAction` are unaffected; this parameter is
 * optional specifically so every existing call site keeps compiling.
 */
export function filterNavSections(
  sections: NavSection[],
  viewableModules: Module[] | "all",
  actionModules?: Partial<Record<Action, Module[] | "all">>
): NavSection[] {
  const viewableSet = viewableModules === "all" ? "all" : new Set(viewableModules);
  const actionSets = new Map<Action, Set<Module> | "all">();
  if (actionModules) {
    for (const [action, modules] of Object.entries(actionModules) as [Action, Module[] | "all"][]) {
      actionSets.set(action, modules === "all" ? "all" : new Set(modules));
    }
  }
  const canView = (modules: Module[]) => viewableSet === "all" || modules.some((m) => viewableSet.has(m));
  const canViewLeaf = (leaf: NavLeaf) => {
    if (!leaf.requiredAction || leaf.requiredAction === "view") return canView(leaf.modules);
    // "all" is this codebase's platform-admin bypass sentinel (see
    // PermissionService.getViewableModules()) — a platform admin's `can()`
    // check bypasses every action, not just "view", so it must bypass a
    // leaf's requiredAction here too, even if actionModules wasn't
    // separately supplied for this specific action.
    if (viewableSet === "all") return true;
    const set = actionSets.get(leaf.requiredAction);
    if (!set) return false; // requiredAction declared but no matching set was ever computed — fail closed, not open
    return set === "all" || leaf.modules.some((m) => set.has(m));
  };

  return sections.reduce<NavSection[]>((acc, section) => {
    const visibleChildren = section.children?.filter(canViewLeaf);
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
