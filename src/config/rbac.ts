/**
 * Canonical module/action/role catalog — single source of truth shared by the
 * permission seed data (prisma/seed.ts) and PermissionService checks.
 */

// masters_core = Customer/Supplier/Employee/Product/Warehouse/etc; masters_finance =
// Bank Account/Payment Type/Cost Master — split so day-to-day floor/warehouse roles
// never implicitly get edit rights on financial masters (see CLAUDE.md 2026-08-17).
export const MODULES = [
  "dashboard",
  "masters_core",
  "masters_finance",
  "crm",
  "marketing",
  "hrms_attendance",
  "hrms_leave",
  "sampling",
  "buyer_enquiries",
  "sales_orders",
  "bom_mrp",
  "production",
  "qc",
  "inventory",
  "purchasing",
  "accounts",
  "invoices",
  "payments",
  "expenses",
  "financial_reports",
  "dispatch",
  "reports",
  "administration",
] as const;
export type Module = (typeof MODULES)[number];

export const ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  "reject",
  "post",
  "cancel",
  "export",
  "print",
] as const;
export type Action = (typeof ACTIONS)[number];

export const ROLES = [
  "SUPER_ADMIN",
  "MANAGEMENT",
  "MERCHANDISER",
  "SAMPLING_MANAGER",
  "PRODUCTION_MANAGER",
  "PRODUCTION_SUPERVISOR",
  "QC_MANAGER",
  "STORE_MANAGER",
  "ACCOUNTS_MANAGER",
  "ACCOUNTS_EXECUTIVE",
  "DISPATCH_MANAGER",
  "WAREHOUSE_USER",
  "VIEWER",
] as const;
export type RoleName = (typeof ROLES)[number];

export function permissionKey(module: Module, action: Action): string {
  return `${module}.${action}`;
}

/**
 * Role → module → allowed actions, condensed from the CLAUDE.md permission
 * matrix. Used by prisma/seed.ts to populate permissions/role_permissions.
 */
export const ROLE_PERMISSIONS: Record<RoleName, Partial<Record<Module, Action[]>>> = {
  SUPER_ADMIN: Object.fromEntries(MODULES.map((m) => [m, [...ACTIONS]])) as Record<Module, Action[]>,
  MANAGEMENT: {
    dashboard: ["view"],
    masters_core: ["view"],
    masters_finance: ["view"],
    crm: ["view", "export"],
    // Approve/reject added deliberately for the Campaign approval workflow —
    // MANAGEMENT is the checkpoint (mirrors their identical approve/reject
    // shape on `sampling` just below), MERCHANDISER (the creator) stays
    // view/create/edit/export/print only, same self-approval-guard reasoning
    // as every other final approval checkpoint in this project.
    marketing: ["view", "approve", "reject", "export"],
    // No dedicated HR role exists yet in this system — MANAGEMENT owns
    // attendance/leave for now (same "closest existing manager role" default
    // used for crm/marketing above), including leave approval.
    hrms_attendance: ["view", "create", "edit", "export"],
    hrms_leave: ["view", "create", "edit", "approve", "reject", "export"],
    sampling: ["view", "approve", "reject"],
    buyer_enquiries: ["view", "reject"],
    sales_orders: ["view", "approve", "export"],
    bom_mrp: ["view"],
    // "approve" here gates Lot restructure (split/merge) and forward
    // stage-skip overrides (see PRODUCTION_MODULE_DESIGN.md §7/§9) — reuses
    // the existing action rather than inventing new production-specific verbs.
    production: ["view", "approve", "export"],
    qc: ["view", "export"],
    inventory: ["view", "export"],
    purchasing: ["view", "approve"],
    accounts: ["view", "export"],
    invoices: ["view", "export"],
    payments: ["view", "approve"],
    expenses: ["view", "approve"],
    financial_reports: ["view", "export", "print"],
    dispatch: ["view", "export"],
    reports: ["view", "export", "print"],
    administration: ["view"],
  },
  MERCHANDISER: {
    dashboard: ["view"],
    masters_core: ["view", "create", "edit"],
    crm: ["view", "create", "edit", "export", "print"],
    marketing: ["view", "create", "edit", "export", "print"],
    sampling: ["view", "create", "edit", "export", "print"],
    buyer_enquiries: ["view", "create", "edit", "reject", "export", "print"],
    sales_orders: ["view", "create", "edit", "cancel", "export", "print"],
    bom_mrp: ["view", "create", "edit"],
    production: ["view"],
    qc: ["view"],
    // "create"/"edit" here are for raising and editing their own Material
    // Requests — Merchandisers don't touch real commercial Purchase Orders.
    inventory: ["view", "create", "edit"],
    purchasing: ["view", "create"],
    reports: ["view", "export", "print"],
  },
  SAMPLING_MANAGER: {
    dashboard: ["view"],
    masters_core: ["view"],
    sampling: ["view", "create", "edit", "delete", "approve", "reject", "export", "print"],
    buyer_enquiries: ["view"],
    sales_orders: ["view"],
    bom_mrp: ["view"],
    production: ["view"],
    qc: ["view", "create"],
    reports: ["view", "export", "print"],
  },
  PRODUCTION_MANAGER: {
    dashboard: ["view"],
    masters_core: ["view"],
    sampling: ["view"],
    buyer_enquiries: ["view"],
    sales_orders: ["view"],
    bom_mrp: ["view", "create", "edit", "export"],
    // "approve" gates Lot restructure (split/merge) and forward stage-skip
    // overrides — see PRODUCTION_MODULE_DESIGN.md §7/§9.
    production: ["view", "create", "edit", "approve", "cancel", "export", "print"],
    qc: ["view"],
    // Same reasoning as MERCHANDISER above — raising/editing Material
    // Requests, not creating real commercial Purchase Orders.
    inventory: ["view", "create", "edit"],
    purchasing: ["view", "create"],
    reports: ["view", "export", "print"],
  },
  PRODUCTION_SUPERVISOR: {
    dashboard: ["view"],
    masters_core: ["view"],
    sales_orders: ["view"],
    bom_mrp: ["view"],
    production: ["view", "create", "edit"],
    qc: ["view", "create"],
    inventory: ["view", "create"],
    reports: ["view"],
  },
  QC_MANAGER: {
    dashboard: ["view"],
    masters_core: ["view"],
    sampling: ["view"],
    buyer_enquiries: ["view"],
    bom_mrp: ["view"],
    production: ["view"],
    qc: ["view", "create", "edit", "approve", "reject", "export", "print"],
    inventory: ["view"],
    reports: ["view", "export", "print"],
  },
  STORE_MANAGER: {
    dashboard: ["view"],
    masters_core: ["view", "create", "edit"],
    bom_mrp: ["view"],
    production: ["view"],
    inventory: ["view", "create", "edit", "delete", "export", "print"],
    purchasing: ["view", "create", "edit", "approve", "export", "print"],
    dispatch: ["view"],
    reports: ["view", "export", "print"],
  },
  ACCOUNTS_MANAGER: {
    dashboard: ["view"],
    masters_core: ["view", "create", "edit"],
    masters_finance: ["view", "create", "edit"],
    sales_orders: ["view"],
    purchasing: ["view", "approve"],
    accounts: ["view", "create", "edit", "post", "cancel", "export", "print"],
    invoices: ["view", "create", "edit", "post", "cancel", "export", "print"],
    payments: ["view", "create", "approve", "cancel", "export", "print"],
    expenses: ["view", "create", "edit", "approve", "cancel", "export", "print"],
    financial_reports: ["view", "export", "print"],
    administration: ["view"],
    reports: ["view", "export", "print"],
  },
  ACCOUNTS_EXECUTIVE: {
    dashboard: ["view"],
    masters_core: ["view"],
    masters_finance: ["view"],
    sales_orders: ["view", "create"],
    purchasing: ["view", "create"],
    accounts: ["view", "create"],
    invoices: ["view", "create", "edit"],
    payments: ["view", "create"],
    expenses: ["view", "create", "edit"],
    financial_reports: ["view", "export"],
    reports: ["view", "export", "print"],
  },
  DISPATCH_MANAGER: {
    dashboard: ["view"],
    masters_core: ["view"],
    sales_orders: ["view"],
    production: ["view"],
    inventory: ["view"],
    dispatch: ["view", "create", "edit", "post", "delete", "cancel", "export", "print"],
    reports: ["view", "export", "print"],
  },
  WAREHOUSE_USER: {
    dashboard: ["view"],
    masters_core: ["view"],
    bom_mrp: ["view"],
    production: ["view"],
    qc: ["view"],
    inventory: ["view", "create", "edit"],
    purchasing: ["view", "create"],
    dispatch: ["view", "create", "edit"],
    reports: ["view"],
  },
  VIEWER: Object.fromEntries(MODULES.map((m) => [m, ["view"] as Action[]])) as Record<Module, Action[]>,
};
