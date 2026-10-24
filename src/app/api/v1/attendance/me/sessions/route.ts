import { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { requireLinkedEmployee } from "@/modules/hrms/attendance-session.core";
import { listSessions } from "@/modules/hrms/attendance-session.service";

/** Your own punch sessions: ?date=YYYY-MM-DD or ?month=YYYY-MM */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  return hrmsRoute("hrms_attendance", "view", async (actor) => {
    const employee = await requireLinkedEmployee(actor.companyId, actor.userId);
    return listSessions(actor, { employeeId: employee.id, date: p.get("date") || undefined, month: p.get("month") || undefined });
  });
}
