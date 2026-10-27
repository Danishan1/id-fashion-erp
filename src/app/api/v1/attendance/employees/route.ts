import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { ALL_ATTENDANCE_MODULES } from "@/modules/hrms/hrms-scope";
import { listScopedEmployees } from "@/modules/hrms/attendance-settings.service";

/** Employee picker for attendance pages, limited to the caller's HRMS scope. */
export async function GET() {
  return hrmsRoute(ALL_ATTENDANCE_MODULES, "view", (actor) => listScopedEmployees(actor));
}
