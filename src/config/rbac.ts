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
  // Piece-Rate Rate Card / Earning Ledger (2026-09-18) — deliberately a
  // separate module from "production": ordinary workers/unit users must
  // never edit their own rates unless explicitly authorized, and this
  // module's grants (below) are intentionally narrower than production's own.
  // RBAC audit (2026-09-24) split this further: `piece_rate` now covers only
  // worker-assignment/rate-resolution/earning-ledger actions; master Rate
  // Card CRUD moved to its own `rate_card` module below, so a role that can
  // assign a worker/trigger rate resolution no longer implicitly gets the
  // ability to create or edit the company's priced Rate Card rows.
  "piece_rate",
  "rate_card",
  // Inventory/Purchasing granularity split (RBAC audit, 2026-09-24) — the
  // old flat `inventory.create`/`inventory.edit` conflated three unrelated
  // business operations (raising a Material Request, creating a Stock
  // Movement, creating/reversing a Goods Receipt) under one key. Material
  // Request now has its own module; `inventory` keeps Stock Balances/Stock
  // Movements/Goods Receipt (not flagged as needing its own split — see
  // RBAC_AUDIT_REPORT.md). Likewise `purchasing` is renamed `purchase_order`
  // (a plainer, more precise name for what it actually gates).
  "material_request",
  "inventory",
  "purchase_order",
  "accounts",
  "invoices",
  "payments",
  "expenses",
  "financial_reports",
  "dispatch",
  "reports",
  // Administration granularity split (RBAC audit, 2026-09-24) — the old flat
  // `administration.view` exposed the full User list (with emails), the
  // full Roles list + every role's permission matrix, and company/AI-provider
  // settings as one undifferentiated bucket. Split into 3 modules mirroring
  // the exact precedent already used once for `masters_core`/`masters_finance`
  // (2026-08-17) — a plain string-column change, no schema migration needed.
  "administration_users",
  "administration_roles",
  "administration_settings",
  "ai_garment_flow",
  "ai_designer",
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
  // Distinct from "edit" — lets a Manager set a piece-rate assignment's rate
  // to something other than what resolvePieceRate() found, with a required
  // reason. Deliberately its own verb rather than folding into "edit" so an
  // ordinary Supervisor (who has piece_rate.create/edit) can assign work
  // without also being able to hand-pick a rate outside the Rate Card.
  "override",
] as const;
export type Action = (typeof ACTIONS)[number];

export const ROLES = [
  "SUPER_ADMIN",
  "MANAGEMENT",
  "MERCHANDISER",
  "SAMPLING_MANAGER",
  "PRODUCTION_MANAGER",
  "PRODUCTION_SUPERVISOR",
  "PRODUCTION_WORKER",
  // A vendor/contractor-side login (2026-09-18) — scoped server-side via
  // User.supplierId + PermissionService.getAllowedSupplierId, the same
  // "minimal grant + narrow server-side identity check" shape as
  // PRODUCTION_WORKER's employeeId-based self-entry scoping above.
  // Deliberately gets NO other module — sales_orders/accounts/
  // financial_reports etc. are completely unreachable, not merely filtered.
  "EXTERNAL_UNIT_USER",
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
    // Approve/reject added for the Attendance Correction Request workflow —
    // same "MANAGEMENT is the checkpoint" shape as hrms_leave just below.
    hrms_attendance: ["view", "create", "edit", "approve", "reject", "export"],
    hrms_leave: ["view", "create", "edit", "approve", "reject", "export"],
    sampling: ["view", "approve", "reject"],
    buyer_enquiries: ["view", "reject"],
    sales_orders: ["view", "approve", "export"],
    // "approve" here gates BOM version approval — reuses the existing
    // action rather than inventing a new verb, same as sales_orders/
    // production/sampling above.
    bom_mrp: ["view", "approve"],
    // "approve" here gates Lot restructure (split/merge) and forward
    // stage-skip overrides (see PRODUCTION_MODULE_DESIGN.md §7/§9) — reuses
    // the existing action rather than inventing new production-specific verbs.
    production: ["view", "approve", "export"],
    qc: ["view", "export"],
    // Earning approval checkpoint — same shape as production's own
    // view/approve/export above.
    piece_rate: ["view", "approve", "export"],
    // View-only oversight, matching MANAGEMENT's own "sees every module"
    // pattern — Rate Card CRUD itself stays owned by PRODUCTION_MANAGER only.
    rate_card: ["view"],
    inventory: ["view", "export"],
    material_request: ["view", "export"],
    purchase_order: ["view", "approve"],
    accounts: ["view", "export"],
    invoices: ["view", "export"],
    payments: ["view", "approve"],
    // "approve"/"reject" here is the Admin decision step (no cash movement)
    // — Management does not itself pay an expense, that's Accountant's "post".
    expenses: ["view", "approve", "reject"],
    financial_reports: ["view", "export", "print"],
    dispatch: ["view", "export"],
    reports: ["view", "export", "print"],
    administration_users: ["view"],
    administration_roles: ["view"],
    administration_settings: ["view"],
    ai_garment_flow: ["view"],
    // "approve" added 2026-09-14 for Tech Pack's own approve/revision
    // discipline -- a maker/checker split (Merchandiser generates/edits,
    // Management approves); MERCHANDISER deliberately does not get it (the
    // self-approval guard would block them from approving their own tech
    // pack anyway unless they're also SUPER_ADMIN).
    ai_designer: ["view", "approve"],
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
    inventory: ["view"],
    // Full control over their own Material Requests — including triggering
    // the sanctioned "generate Purchase Order(s) from shortfall" flow
    // (gated on material_request.edit, not purchase_order.create — see
    // RBAC_AUDIT_REPORT.md). Deliberately NO purchase_order.create: a
    // Merchandiser must never be able to create a direct, arbitrary
    // commercial Purchase Order — only view one already generated from
    // their own Material Request.
    material_request: ["view", "create", "edit", "cancel"],
    purchase_order: ["view"],
    reports: ["view", "export", "print"],
    ai_garment_flow: ["view", "create", "edit", "delete", "cancel", "export", "print"],
    ai_designer: ["view", "create", "edit", "delete", "cancel", "export", "print"],
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
    // "approve" here gates BOM version approval — Production Manager is the
    // second real-world approver alongside Management for a style's BOM.
    bom_mrp: ["view", "create", "edit", "approve", "export"],
    // "approve" gates Lot restructure (split/merge) and forward stage-skip
    // overrides — see PRODUCTION_MODULE_DESIGN.md §7/§9.
    production: ["view", "create", "edit", "approve", "cancel", "export", "print"],
    qc: ["view"],
    // Can assign workers / trigger rate resolution and authorize an
    // assignment-time rate override. Master Rate Card CRUD is now its own
    // module, below — assigning a worker no longer implies rate-card
    // ownership (see RBAC_AUDIT_REPORT.md).
    piece_rate: ["view", "create", "approve", "override", "export"],
    // Owns the company's master Rate Card — the one role that can create/
    // edit the priced rows worker assignments resolve against.
    rate_card: ["view", "create", "edit"],
    inventory: ["view"],
    // Full control over their own Material Requests, including triggering
    // "generate Purchase Order(s) from shortfall" (gated on
    // material_request.edit — see RBAC_AUDIT_REPORT.md).
    material_request: ["view", "create", "edit", "cancel"],
    // Unlike MERCHANDISER, Production Manager's Purchasing access is kept
    // exactly as it already was (explicit instruction: "Purchasing access
    // must remain according to the existing matrix") — they can still
    // create a Purchase Order directly.
    purchase_order: ["view", "create"],
    reports: ["view", "export", "print"],
  },
  PRODUCTION_SUPERVISOR: {
    dashboard: ["view"],
    masters_core: ["view"],
    sales_orders: ["view"],
    bom_mrp: ["view"],
    // "approve" added for the worker self-entry approval queue (2026-09-02) —
    // a Supervisor approves/rejects a worker's own submitted progress entry
    // before it counts toward the Job Order's real quantities.
    production: ["view", "create", "edit", "approve"],
    qc: ["view", "create"],
    // Can assign workers/trigger rate resolution but NOT override an
    // authorized rate without escalating to Production Manager, and
    // deliberately holds NO `rate_card` grant at all — assigning a worker
    // must never imply the ability to create/edit the master Rate Card
    // (RBAC audit, 2026-09-24 — this was a real gap: piece_rate.create used
    // to also pass the Rate Card creation route's check).
    piece_rate: ["view", "create"],
    inventory: ["view"],
    material_request: ["view", "create"],
    reports: ["view"],
  },
  // A shop-floor worker with their own login (linked via User.employeeId),
  // added 2026-09-02 for the optional self-entry workflow — see
  // submitSelfProgressEntry in job-order.service.ts. Deliberately minimal:
  // "create" here means "submit my own progress entry," never a general
  // production-editing right — enforced server-side (self-only employeeId,
  // must be assigned to the job order, Employee.selfEntryEnabled must be
  // true) rather than by a broader permission grant. Stage scope is further
  // narrowed per-company via RoleProductionStageAccess, same as any role.
  PRODUCTION_WORKER: {
    dashboard: ["view"],
    production: ["view", "create"],
    // Granted at the RBAC layer; whether a worker actually SEES their own
    // rate is additionally gated by ProductionSettings.workersCanViewOwnRate
    // and scoped to their own Employee — see piece-rate-card routes.
    piece_rate: ["view"],
  },
  // A vendor/contractor-side login, added for the External Job-Work upgrade
  // (2026-09-18) — scoped server-side via User.supplierId +
  // PermissionService.getAllowedSupplierId (job-work-order.service.ts's
  // assertJobWorkOrderSupplierAccess/assertInternalUser), same "minimal
  // grant + narrow server-side identity check" shape as PRODUCTION_WORKER's
  // own employeeId-based self-entry scoping just above. Deliberately gets NO
  // other module — sales_orders/accounts/financial_reports etc. are
  // completely unreachable, not merely filtered, and no export/approve/edit/
  // cancel on production either (defense in depth alongside the identity
  // check itself).
  EXTERNAL_UNIT_USER: {
    dashboard: ["view"],
    production: ["view", "create"],
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
    material_request: ["view"],
    reports: ["view", "export", "print"],
  },
  STORE_MANAGER: {
    dashboard: ["view"],
    masters_core: ["view", "create", "edit"],
    bom_mrp: ["view"],
    production: ["view"],
    inventory: ["view", "create", "edit", "delete", "export", "print"],
    material_request: ["view", "create", "edit", "cancel", "export"],
    purchase_order: ["view", "create", "edit", "approve", "export", "print"],
    dispatch: ["view"],
    reports: ["view", "export", "print"],
  },
  ACCOUNTS_MANAGER: {
    dashboard: ["view"],
    masters_core: ["view", "create", "edit"],
    masters_finance: ["view", "create", "edit"],
    sales_orders: ["view"],
    purchase_order: ["view", "approve"],
    accounts: ["view", "create", "edit", "post", "cancel", "export", "print"],
    invoices: ["view", "create", "edit", "post", "cancel", "export", "print"],
    payments: ["view", "create", "approve", "cancel", "export", "print"],
    // "approve"/"reject" (the Admin decision) AND "post" (the Accountant
    // pays step) both granted here — a senior Accounts Manager can act as
    // either, unlike ACCOUNTS_EXECUTIVE below which gets neither.
    expenses: ["view", "create", "edit", "approve", "reject", "post", "cancel", "export", "print"],
    financial_reports: ["view", "export", "print"],
    // Limited administrative visibility (company/AI-provider settings) only
    // — deliberately NOT administration_users/administration_roles, per the
    // RBAC audit's own explicit decision: this role should not automatically
    // gain visibility into the full User list (with emails) or the Roles/
    // permission matrix just because it needs to see company settings.
    administration_settings: ["view"],
    reports: ["view", "export", "print"],
    // Read-only visibility into approved/payable earnings for
    // payroll/accounts to later consume — this is explicitly NOT payroll.
    // No `rate_card` grant — Accounts must never modify production rates.
    piece_rate: ["view", "export"],
  },
  ACCOUNTS_EXECUTIVE: {
    dashboard: ["view"],
    masters_core: ["view"],
    masters_finance: ["view"],
    sales_orders: ["view", "create"],
    purchase_order: ["view", "create"],
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
    material_request: ["view"],
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
    material_request: ["view", "create", "edit", "cancel"],
    purchase_order: ["view", "create"],
    dispatch: ["view", "create", "edit"],
    reports: ["view"],
  },
  VIEWER: Object.fromEntries(MODULES.map((m) => [m, ["view"] as Action[]])) as Record<Module, Action[]>,
};
