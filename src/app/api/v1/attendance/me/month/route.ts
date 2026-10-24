import { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { computeEmployeesMonth, parseMonth } from "@/modules/hrms/attendance-month.service";
import { requireLinkedEmployee } from "@/modules/hrms/attendance-session.core";

export async function GET(req: NextRequest) {
  return hrmsRoute("hrms_attendance", "view", async (actor) => {
    const employee = await requireLinkedEmployee(actor.companyId, actor.userId);
    const { year, month } = parseMonth(req.nextUrl.searchParams.get("month"));
    const [result] = await computeEmployeesMonth(actor.companyId, [employee.id], year, month);
    return { year, month, ...result };
  });
}
