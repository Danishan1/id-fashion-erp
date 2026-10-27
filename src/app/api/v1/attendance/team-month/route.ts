import { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { parseMonth } from "@/modules/hrms/attendance-month.service";
import { getTeamMonth } from "@/modules/hrms/attendance-team.service";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  return hrmsRoute("hrms_attendance_records", "view", (actor) => {
    const { year, month } = parseMonth(p.get("month"));
    return getTeamMonth(actor, year, month, p.get("search") || undefined);
  });
}
