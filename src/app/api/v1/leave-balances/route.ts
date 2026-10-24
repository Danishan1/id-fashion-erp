import { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { parseMonth } from "@/modules/hrms/attendance-month.service";
import { listLeaveBalances } from "@/modules/hrms/leave-balance.service";

/** Monthly leave balances: ?month=YYYY-MM&employeeId=…&mine=true */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  return hrmsRoute("hrms_leave", "view", (actor) => {
    const { year, month } = parseMonth(p.get("month"));
    return listLeaveBalances(actor, { year, month, employeeId: p.get("employeeId") || undefined, mine: p.get("mine") === "true" });
  });
}
