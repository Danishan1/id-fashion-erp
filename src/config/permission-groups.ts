import { ACTIONS, MODULES, ROLE_PERMISSIONS, type Action, type Module } from "./rbac";
import { CORE_MODULES, ENTITLEMENT_PACKAGES } from "./module-entitlements";

/**
 * P6 (2026-10-21): how the role permission matrix and the per-user override
 * picker group the RBAC modules, and which actions are meaningful for each.
 * Client-safe (no Prisma).
 *
 * Groups reuse the platform's module packages (Accounts, CRM, HRMS, ...) so
 * the same names appear everywhere; core modules form their own group.
 */
export interface PermissionGroup {
  key: string;
  label: string;
  modules: Module[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = (() => {
  const groups: PermissionGroup[] = [
    { key: "core", label: "Core (always on)", modules: [...CORE_MODULES] },
    ...ENTITLEMENT_PACKAGES.map((p) => ({ key: p.key, label: p.label, modules: [...p.modules] })),
  ];
  const covered = new Set(groups.flatMap((g) => g.modules));
  const rest = MODULES.filter((m) => !covered.has(m));
  if (rest.length > 0) groups.push({ key: "other", label: "Other", modules: rest });
  return groups;
})();

/** Screen names for modules whose key does not read well on its own. */
const MODULE_LABELS: Record<string, string> = {
  hrms_attendance: "My Attendance (punch)",
  hrms_attendance_team: "Team Attendance",
  hrms_attendance_records: "Monthly Records",
  hrms_attendance_regularization: "Regularization",
  hrms_attendance_outdoor: "Outdoor Punches",
  hrms_attendance_overtime: "Overtime",
  hrms_attendance_photos: "Punch Photos",
  hrms_attendance_salary: "Salary Sheet",
  hrms_attendance_settings: "Attendance Settings",
  hrms_leave: "Leave Requests",
  hrms_leave_balances: "Leave Balances",
  hrms_leave_types: "Leave Types",
  hrms_salary_setup: "Salary Setup",
  hrms_salary_attendance: "Manage Attendance (salary)",
  hrms_salary_generate: "Generate Salary",
  payment_requests: "Payment Requests",
  payment_request_settings: "Payment Approval Matrix",
};

/** Readable module name, e.g. "masters_core" -> "Masters core". */
export function moduleLabel(module: string): string {
  if (MODULE_LABELS[module]) return MODULE_LABELS[module];
  const text = module.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Actions that mean something for a module: every action any built-in role
 * (other than SUPER_ADMIN, which holds everything) is given on it, plus
 * "view". The matrix hides the rest behind "Show all actions" -- they can
 * still be granted, they're just not offered by default.
 */
export function relevantActions(module: Module): Action[] {
  const used = new Set<Action>(["view"]);
  for (const [roleName, grants] of Object.entries(ROLE_PERMISSIONS)) {
    if (roleName === "SUPER_ADMIN") continue;
    for (const action of (grants as Partial<Record<Module, Action[]>>)[module] ?? []) used.add(action);
  }
  return ACTIONS.filter((a) => used.has(a));
}
