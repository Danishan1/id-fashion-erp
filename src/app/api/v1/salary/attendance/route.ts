import type { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { parseMonth } from "@/modules/hrms/attendance-month.service";
import { listSalaryAttendance } from "@/modules/hrms/salary-attendance.service";

export function GET(req: NextRequest) {
  const { year, month } = parseMonth(req.nextUrl.searchParams.get("month"));
  return hrmsRoute("hrms_salary_attendance", "view", (actor) => listSalaryAttendance(actor, year, month));
}
