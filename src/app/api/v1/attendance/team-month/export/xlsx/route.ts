import { NextRequest, NextResponse } from "next/server";
import { xlsxResponseHeaders } from "@/lib/xlsx";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { parseMonth } from "@/modules/hrms/attendance-month.service";
import { exportTeamMonthXlsx } from "@/modules/hrms/attendance-team.service";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  return hrmsRoute("hrms_attendance", "export", async (actor) => {
    const { year, month } = parseMonth(p.get("month"));
    const buffer = await exportTeamMonthXlsx(actor, year, month, p.get("search") || undefined);
    return new NextResponse(new Uint8Array(buffer), { headers: xlsxResponseHeaders(`Monthly_Attendance_${year}-${String(month).padStart(2, "0")}.xlsx`) });
  });
}
