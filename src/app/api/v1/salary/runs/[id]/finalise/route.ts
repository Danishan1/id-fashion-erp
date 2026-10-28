import type { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { finaliseSalaryRun } from "@/modules/hrms/salary-run.service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return hrmsRoute("hrms_salary_generate", "post", (actor) => finaliseSalaryRun(actor, id));
}
