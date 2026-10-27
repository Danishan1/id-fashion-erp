import { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { parseMonth } from "@/modules/hrms/attendance-month.service";
import { runMonthlyCredit } from "@/modules/hrms/leave-balance.service";

/** Credit a month's leave quota now (the worker also does this every day). Body: { month: "YYYY-MM" } */
export async function POST(req: NextRequest) {
  return hrmsRoute("hrms_leave_balances", "edit", async (actor) => {
    const body = await req.json().catch(() => ({}));
    const { year, month } = parseMonth(typeof body?.month === "string" ? body.month : null);
    return runMonthlyCredit(actor, year, month);
  });
}
