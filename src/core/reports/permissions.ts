import { PermissionService } from "@/core/rbac/PermissionService";
import type { Action, Module } from "@/config/rbac";

/**
 * Every report category asserts the umbrella `reports.<action>` permission
 * AND the "owning module" permission for that category — reuses the existing
 * RBAC catalog unchanged (no new modules/actions). See CLAUDE.md's Phase 9
 * section for the full category -> module map this table encodes.
 */
export const REPORT_CATEGORY_MODULES = {
  "sales-orders": ["sales_orders"],
  purchase: ["purchasing"],
  suppliers: ["purchasing"],
  sampling: ["sampling"],
  "sampling-raw-material": ["sampling"],
  inventory: ["inventory"],
  warehouse: ["inventory"],
  production: ["production"],
  "production-planning": ["production"],
  "material-consumption": ["production"],
  quality: ["qc"],
  packing: ["dispatch"],
  dispatch: ["dispatch"],
  customers: ["masters_core"],
  products: ["masters_core"],
  invoicing: ["accounts", "financial_reports"],
  accounts: ["accounts", "financial_reports"],
  receivables: ["accounts", "financial_reports"],
  payables: ["accounts", "financial_reports"],
  expenses: ["accounts", "financial_reports"],
  profitability: ["accounts", "financial_reports"],
  hr: ["hrms_attendance"],
  attendance: ["hrms_attendance"],
  payroll: ["hrms_attendance"],
  audit: ["administration"],
  dashboard: [],
  mis: [],
  "business-performance": ["financial_reports"],
} as const satisfies Record<string, Module[]>;

export type ReportCategory = keyof typeof REPORT_CATEGORY_MODULES;

export const REPORT_CATEGORIES: ReportCategory[] = Object.keys(REPORT_CATEGORY_MODULES) as ReportCategory[];

/**
 * Asserts `reports.<action>` plus every owning module's `view` permission for
 * this category. Categories with no owning module (Dashboard/MIS) only need
 * the umbrella `reports` permission.
 */
export async function assertReportAccess(userId: string, category: ReportCategory, action: Action = "view"): Promise<void> {
  await PermissionService.assert(userId, "reports", action);
  const owningModules = REPORT_CATEGORY_MODULES[category];
  for (const mod of owningModules) {
    await PermissionService.assert(userId, mod, "view");
  }
}

/** Non-throwing check, for redacting sections of a multi-module report (e.g. Order Lifecycle) per-viewer. */
export async function canAccessModule(userId: string, mod: Module): Promise<boolean> {
  return PermissionService.can(userId, mod, "view");
}
