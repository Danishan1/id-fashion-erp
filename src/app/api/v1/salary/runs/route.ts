import type { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { parseMonth } from "@/modules/hrms/attendance-month.service";
import { salaryRunMonthSchema } from "@/modules/hrms/salary-run.schema";
import { generateSalaryRun, getSalaryRunView, previewAttendanceSummary } from "@/modules/hrms/salary-run.service";

/** ?month=YYYY-MM — the run for the month (or none), plus the attendance summary when there is no run yet. */
export function GET(req: NextRequest) {
  const { year, month } = parseMonth(req.nextUrl.searchParams.get("month"));
  return hrmsRoute("hrms_salary_generate", "view", async (actor) => {
    const view = await getSalaryRunView(actor, year, month);
    return { ...view, summary: view.run ? null : await previewAttendanceSummary(actor, year, month) };
  });
}

/** Generate (or regenerate a draft) for { month: "YYYY-MM" }. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return hrmsRoute("hrms_salary_generate", "create", (actor) => {
    const { year, month } = parseMonth(salaryRunMonthSchema.parse(body).month);
    return generateSalaryRun(actor, year, month);
  });
}
