import type { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { listEmployeeSalarySetups } from "@/modules/hrms/salary-setup.service";

export function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.get("search") ?? undefined;
  return hrmsRoute("hrms_salary_setup", "view", (actor) => listEmployeeSalarySetups(actor.companyId, { search }));
}
