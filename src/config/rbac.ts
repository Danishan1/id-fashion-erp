/**
 * Canonical module/action/role catalog — single source of truth shared by the
 * permission seed data (prisma/seed.ts) and PermissionService checks.
 */

export const MODULES = [
  "dashboard",
  "masters",
  "sampling",
  "sales_orders",
  "bom_mrp",
  "production",
  "qc",
  "inventory",
  "purchasing",
  "accounts",
  "invoices",
  "payments",
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
    masters: ["view"],
    sampling: ["view", "approve", "reject"],
    sales_orders: ["view", "approve", "export"],
    bom_mrp: ["view"],
    production: ["view", "export"],
    qc: ["view", "export"],
    inventory: ["view", "export"],
    purchasing: ["view", "approve"],
    accounts: ["view", "export"],
    invoices: ["view", "export"],
    payments: ["view", "approve"],
    financial_reports: ["view", "export", "print"],
    dispatch: ["view", "export"],
    reports: ["view", "export", "print"],
    administration: ["view"],
  },
  MERCHANDISER: {
    dashboard: ["view"],
    masters: ["view", "create", "edit"],
    sampling: ["view", "create", "edit", "export", "print"],
    sales_orders: ["view", "create", "edit", "cancel", "export", "print"],
    bom_mrp: ["view", "create", "edit"],
    production: ["view"],
    qc: ["view"],
    inventory: ["view"],
    purchasing: ["view", "create"],
    reports: ["view", "export", "print"],
  },
  SAMPLING_MANAGER: {
    dashboard: ["view"],
    masters: ["view"],
    sampling: ["view", "create", "edit", "delete", "approve", "reject", "export", "print"],
    sales_orders: ["view"],
    bom_mrp: ["view"],
    production: ["view"],
    qc: ["view", "create"],
    reports: ["view", "export", "print"],
  },
  PRODUCTION_MANAGER: {
    dashboard: ["view"],
    masters: ["view"],
    sampling: ["view"],
    sales_orders: ["view"],
    bom_mrp: ["view", "create", "edit", "export"],
    production: ["view", "create", "edit", "cancel", "export", "print"],
    qc: ["view"],
    inventory: ["view"],
    purchasing: ["view", "create"],
    reports: ["view", "export", "print"],
  },
  PRODUCTION_SUPERVISOR: {
    dashboard: ["view"],
    masters: ["view"],
    sales_orders: ["view"],
    bom_mrp: ["view"],
    production: ["view", "create", "edit"],
    qc: ["view", "create"],
    inventory: ["view", "create"],
    reports: ["view"],
  },
  QC_MANAGER: {
    dashboard: ["view"],
    masters: ["view"],
    sampling: ["view"],
    bom_mrp: ["view"],
    production: ["view"],
    qc: ["view", "create", "edit", "approve", "reject", "export", "print"],
    inventory: ["view"],
    reports: ["view", "export", "print"],
  },
  STORE_MANAGER: {
    dashboard: ["view"],
    masters: ["view", "create", "edit"],
    bom_mrp: ["view"],
    production: ["view"],
    inventory: ["view", "create", "edit", "delete", "export", "print"],
    purchasing: ["view", "create", "edit", "approve", "export", "print"],
    dispatch: ["view"],
    reports: ["view", "export", "print"],
  },
  ACCOUNTS_MANAGER: {
    dashboard: ["view"],
    masters: ["view", "create", "edit"],
    sales_orders: ["view"],
    purchasing: ["view", "approve"],
    accounts: ["view", "create", "edit", "post", "cancel", "export", "print"],
    invoices: ["view", "create", "edit", "post", "cancel", "export", "print"],
    payments: ["view", "create", "approve", "cancel", "export", "print"],
    financial_reports: ["view", "export", "print"],
    administration: ["view"],
    reports: ["view", "export", "print"],
  },
  ACCOUNTS_EXECUTIVE: {
    dashboard: ["view"],
    masters: ["view"],
    sales_orders: ["view", "create"],
    purchasing: ["view", "create"],
    accounts: ["view", "create"],
    invoices: ["view", "create", "edit"],
    payments: ["view", "create"],
    financial_reports: ["view", "export"],
    reports: ["view", "export", "print"],
  },
  DISPATCH_MANAGER: {
    dashboard: ["view"],
    masters: ["view"],
    sales_orders: ["view"],
    production: ["view"],
    inventory: ["view"],
    dispatch: ["view", "create", "edit", "delete", "cancel", "export", "print"],
    reports: ["view", "export", "print"],
  },
  WAREHOUSE_USER: {
    dashboard: ["view"],
    masters: ["view"],
    bom_mrp: ["view"],
    production: ["view"],
    qc: ["view"],
    inventory: ["view", "create", "edit"],
    purchasing: ["view", "create"],
    dispatch: ["view", "create"],
    reports: ["view"],
  },
  VIEWER: Object.fromEntries(MODULES.map((m) => [m, ["view"] as Action[]])) as Record<Module, Action[]>,
};
