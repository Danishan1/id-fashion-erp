import { NextRequest, NextResponse } from "next/server";
import { xlsxResponseHeaders } from "@/lib/xlsx";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { parseMonth } from "@/modules/hrms/attendance-month.service";
import { exportSalarySheetXlsx } from "@/modules/hrms/attendance-team.service";

export async function GET(req: NextRequest) {
  return hrmsRoute("hrms_attendance_salary", "export", async (actor) => {
    const { year, month } = parseMonth(req.nextUrl.searchParams.get("month"));
    const buffer = await exportSalarySheetXlsx(actor, year, month);
    return new NextResponse(new Uint8Array(buffer), { headers: xlsxResponseHeaders(`Salary_Sheet_${year}-${String(month).padStart(2, "0")}.xlsx`) });
  });
}
