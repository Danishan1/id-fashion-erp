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

/** Readable module name, e.g. "hrms_leave" -> "Hrms leave". */
export function moduleLabel(module: string): string {
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
