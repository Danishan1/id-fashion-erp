import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getTeamScope } from "@/core/hierarchy/team-scope";

/**
 * P3 (2026-10-21): which employees' HRMS records a user may see and act on.
 *   - `<module>.view_all` → everyone (null)
 *   - otherwise           → their own linked employee plus everyone below
 *                           them in the HRMS reporting hierarchy
 * A user with no linked employee and no view_all sees nobody.
 */
export type HrmsModule =
  | "hrms_attendance"
  | "hrms_attendance_team"
  | "hrms_attendance_records"
  | "hrms_attendance_regularization"
  | "hrms_attendance_outdoor"
  | "hrms_attendance_overtime"
  | "hrms_attendance_photos"
  | "hrms_attendance_salary"
  | "hrms_attendance_settings"
  | "hrms_leave"
  | "hrms_leave_balances"
  | "hrms_leave_types"
  | "hrms_salary_setup"
  | "hrms_salary_attendance"
  | "hrms_salary_generate";

/** One screen module, or several when an API is shared by more than one screen. */
export type HrmsModules = HrmsModule | readonly HrmsModule[];

export function hrmsModuleList(modules: HrmsModules): readonly HrmsModule[] {
  return typeof modules === "string" ? [modules] : modules;
}

/** Every attendance screen module (for APIs every attendance screen uses). */
export const ALL_ATTENDANCE_MODULES: readonly HrmsModule[] = [
  "hrms_attendance",
  "hrms_attendance_team",
  "hrms_attendance_records",
  "hrms_attendance_regularization",
  "hrms_attendance_outdoor",
  "hrms_attendance_overtime",
  "hrms_attendance_photos",
  "hrms_attendance_salary",
  "hrms_attendance_settings",
];

/** `view_all` on any of the given modules → everyone. */
export async function getHrmsEmployeeScope(userId: string, modules: HrmsModules): Promise<string[] | null> {
  for (const mod of hrmsModuleList(modules)) {
    if (await PermissionService.can(userId, mod, "view_all")) return null;
  }
  const team = await getTeamScope(userId, "HRMS");
  return team.employeeId ? [team.employeeId, ...team.teamEmployeeIds] : [];
}

/** `where` fragment on `employeeId` for a scope (empty for everyone). */
export function hrmsEmployeeWhere(scope: string[] | null): { employeeId?: { in: string[] } } {
  return scope === null ? {} : { employeeId: { in: scope } };
}

/** Deny-as-not-found when the employee is outside the caller's HRMS scope. */
export async function assertHrmsEmployeeInScope(
  userId: string,
  module: HrmsModules,
  employeeId: string,
  notFound: { label: string; id: string }
) {
  const scope = await getHrmsEmployeeScope(userId, module);
  if (scope !== null && !scope.includes(employeeId)) {
    throw new BusinessRuleError("NOT_FOUND", `${notFound.label} not found.`, { id: notFound.id });
  }
}
