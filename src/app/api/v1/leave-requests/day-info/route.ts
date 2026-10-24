import { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { getLeaveDayInfo } from "@/modules/hrms/leave.service";

/** ?employeeId=…(optional, defaults to you)&from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  return hrmsRoute("hrms_leave", "view", (actor) => getLeaveDayInfo(actor, p.get("employeeId"), p.get("from") ?? "", p.get("to") ?? ""));
}
