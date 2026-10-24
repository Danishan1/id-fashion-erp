import { NextRequest } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { istDateKey, isValidDateKey } from "@/modules/hrms/attendance-calculator";
import { getTeamDay } from "@/modules/hrms/attendance-team.service";

export async function GET(req: NextRequest) {
  return hrmsRoute("hrms_attendance", "view", (actor) => {
    const date = req.nextUrl.searchParams.get("date") || istDateKey(new Date());
    if (!isValidDateKey(date)) throw new BusinessRuleError("VALIDATION_ERROR", "Date is not valid.");
    return getTeamDay(actor, date);
  });
}
