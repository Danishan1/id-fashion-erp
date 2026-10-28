import type { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { salaryRunReasonSchema } from "@/modules/hrms/salary-run.schema";
import { reopenSalaryRun } from "@/modules/hrms/salary-run.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return hrmsRoute("hrms_salary_generate", "cancel", (actor) => reopenSalaryRun(actor, id, salaryRunReasonSchema.parse(body).reason));
}
