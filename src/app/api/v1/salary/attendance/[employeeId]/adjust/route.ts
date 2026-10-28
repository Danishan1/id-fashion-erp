import type { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { bulkAdjustSchema } from "@/modules/hrms/salary-attendance.schema";
import { adjustSalaryDays } from "@/modules/hrms/salary-attendance.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await params;
  const body = await req.json().catch(() => ({}));
  return hrmsRoute("hrms_salary_attendance", "edit", (actor) => adjustSalaryDays(actor, employeeId, bulkAdjustSchema.parse(body)));
}
