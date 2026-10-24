import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { getMyAttendanceToday } from "@/modules/hrms/attendance-punch.service";

export async function GET() {
  return hrmsRoute("hrms_attendance", "view", (actor) => getMyAttendanceToday(actor));
}
