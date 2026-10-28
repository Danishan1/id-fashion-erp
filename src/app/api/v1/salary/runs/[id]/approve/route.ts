import type { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { approveSalaryRun } from "@/modules/hrms/salary-run.service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return hrmsRoute("hrms_salary_generate", "approve", (actor) => approveSalaryRun(actor, id));
}
