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
export type HrmsModule = "hrms_leave" | "hrms_attendance";

export async function getHrmsEmployeeScope(userId: string, module: HrmsModule): Promise<string[] | null> {
  if (await PermissionService.can(userId, module, "view_all")) return null;
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
  module: HrmsModule,
  employeeId: string,
  notFound: { label: string; id: string }
) {
  const scope = await getHrmsEmployeeScope(userId, module);
  if (scope !== null && !scope.includes(employeeId)) {
    throw new BusinessRuleError("NOT_FOUND", `${notFound.label} not found.`, { id: notFound.id });
  }
}
