import type { Module } from "@/config/rbac";

/**
 * Module entitlements (Platform SaaS Phase 3, PLAT-018). A platform operator
 * turns whole product areas ("packages") on or off per customer company.
 * Each package groups the RBAC modules that make up that area, so turning a
 * package off removes every one of its modules for every user of that
 * company — whatever their roles say.
 *
 * Client-safe (no Prisma) — used by the platform UI, the sidebar, the proxy
 * and PermissionService alike.
 *
 * Modules not in any package are core and always on: Dashboard, Masters,
 * Sales Orders and Administration. A company with no entitlement row for a
 * package has it enabled, so existing customers are unaffected.
 */

export interface EntitlementPackage {
  key: string;
  label: string;
  description: string;
  modules: readonly Module[];
}

export const ENTITLEMENT_PACKAGES = [
  {
    key: "SAMPLING",
    label: "Sampling & Buyer Enquiries",
    description: "Buyer enquiries, sample requests, versions and costing.",
    modules: ["sampling", "buyer_enquiries"],
  },
  {
    key: "PRODUCTION",
    label: "Production, BOM/MRP & QC",
    description: "BOM, MRP, production orders, lots, job work, QC and piece rates.",
    modules: ["bom_mrp", "production", "qc", "piece_rate", "rate_card"],
  },
  {
    key: "PURCHASING",
    label: "Purchasing",
    description: "Purchase orders to suppliers.",
    modules: ["purchase_order"],
  },
  {
    key: "INVENTORY",
    label: "Inventory & Material Requests",
    description: "Goods receipts, stock balances, stock movements, material requests and finished goods inventory.",
    modules: ["inventory", "material_request", "fg_inventory"],
  },
  {
    key: "DISPATCH",
    label: "Dispatch",
    description: "Picking, packing, cartons and delivery.",
    modules: ["dispatch"],
  },
  {
    key: "ACCOUNTS",
    label: "Accounts",
    description: "Journals, invoices, payments, expenses, payment requests and financial reports.",
    modules: ["accounts", "invoices", "payments", "expenses", "payment_requests", "payment_request_settings", "financial_reports"],
  },
  {
    key: "CRM",
    label: "CRM",
    description: "Leads, contacts, companies, opportunities, inbox and activities.",
    modules: ["crm", "crm_settings"],
  },
  {
    key: "MARKETING",
    label: "Marketing",
    description: "Campaigns and campaign imports.",
    modules: ["marketing"],
  },
  {
    key: "HRMS",
    label: "HRMS (Attendance & Leave)",
    description: "Attendance, corrections, leave types and leave requests.",
    modules: [
      "hrms_attendance",
      "hrms_attendance_team",
      "hrms_attendance_records",
      "hrms_attendance_regularization",
      "hrms_attendance_outdoor",
      "hrms_attendance_overtime",
      "hrms_attendance_photos",
      "hrms_attendance_salary",
      "hrms_attendance_settings",
      "hrms_leave",
      "hrms_leave_balances",
      "hrms_leave_types",
      "hrms_salary_setup",
    ],
  },
  {
    key: "BARCODES",
    label: "Barcodes & Scanning",
    description: "Barcode registry, printing and the scanner.",
    modules: ["barcodes"],
  },
  {
    key: "AI_GARMENT_FLOW",
    label: "AI Garment Flow",
    description: "AI-assisted product development projects.",
    modules: ["ai_garment_flow"],
  },
  {
    key: "AI_DESIGNER",
    label: "AI Designer",
    description: "AI design generation, catalogue designs and tech packs.",
    modules: ["ai_designer"],
  },
  {
    key: "REPORTS",
    label: "Reports",
    description: "The Report Center.",
    modules: ["reports"],
  },
] as const satisfies readonly EntitlementPackage[];

export type EntitlementPackageKey = (typeof ENTITLEMENT_PACKAGES)[number]["key"];

export const ENTITLEMENT_PACKAGE_KEYS = ENTITLEMENT_PACKAGES.map((p) => p.key) as EntitlementPackageKey[];

/** Always on — not part of any package. */
export const CORE_MODULES: readonly Module[] = [
  "dashboard",
  "masters_core",
  "masters_finance",
  "sales_orders",
  "administration_users",
  "administration_roles",
  "administration_settings",
];

const PACKAGE_BY_MODULE = new Map<Module, EntitlementPackageKey>();
for (const pkg of ENTITLEMENT_PACKAGES) {
  for (const mod of pkg.modules) PACKAGE_BY_MODULE.set(mod, pkg.key);
}

export function packageForModule(module: Module): EntitlementPackageKey | null {
  return PACKAGE_BY_MODULE.get(module) ?? null;
}

export function isEntitlementPackageKey(value: string): value is EntitlementPackageKey {
  return (ENTITLEMENT_PACKAGE_KEYS as string[]).includes(value);
}

export function getEntitlementPackage(key: EntitlementPackageKey) {
  return ENTITLEMENT_PACKAGES.find((p) => p.key === key)!;
}

/** Every module belonging to the given disabled packages. */
export function modulesOfPackages(keys: Iterable<EntitlementPackageKey>): Set<Module> {
  const result = new Set<Module>();
  for (const key of keys) for (const mod of getEntitlementPackage(key).modules) result.add(mod);
  return result;
}
