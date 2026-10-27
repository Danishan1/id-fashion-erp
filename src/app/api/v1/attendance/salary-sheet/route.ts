import { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { parseMonth } from "@/modules/hrms/attendance-month.service";
import { finaliseSalaryMonth, getSalarySheet } from "@/modules/hrms/attendance-team.service";

export async function GET(req: NextRequest) {
  return hrmsRoute("hrms_attendance_salary", "export", (actor) => {
    const { year, month } = parseMonth(req.nextUrl.searchParams.get("month"));
    return getSalarySheet(actor, year, month);
  });
}

/** Finalise the month: body { month: "YYYY-MM" }. */
export async function POST(req: NextRequest) {
  return hrmsRoute("hrms_attendance_salary", "edit", async (actor) => {
    const body = await req.json().catch(() => ({}));
    const { year, month } = parseMonth(typeof body?.month === "string" ? body.month : null);
    return finaliseSalaryMonth(actor, year, month);
  });
}
