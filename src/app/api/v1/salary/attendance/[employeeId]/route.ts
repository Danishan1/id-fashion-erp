import type { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { parseMonth } from "@/modules/hrms/attendance-month.service";
import { getEmployeeSalaryAttendance } from "@/modules/hrms/salary-attendance.service";

export async function GET(req: NextRequest, { params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await params;
  const { year, month } = parseMonth(req.nextUrl.searchParams.get("month"));
  return hrmsRoute("hrms_salary_attendance", "view", (actor) => getEmployeeSalaryAttendance(actor, employeeId, year, month));
}
