import type { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { listSalaryHistory } from "@/modules/hrms/salary-history.service";

export function GET(req: NextRequest) {
  const y = Number(req.nextUrl.searchParams.get("year"));
  return hrmsRoute("hrms_salary_history", "view", (actor) => listSalaryHistory(actor, Number.isInteger(y) && y > 2000 ? y : undefined));
}
