import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { listScopedEmployees } from "@/modules/hrms/attendance-settings.service";

/** Employee picker for attendance pages, limited to the caller's HRMS scope. */
export async function GET() {
  return hrmsRoute("hrms_attendance", "view", (actor) => listScopedEmployees(actor));
}
