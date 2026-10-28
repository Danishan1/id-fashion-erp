import type { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { editSalaryLineSchema } from "@/modules/hrms/salary-run.schema";
import { editSalaryLine } from "@/modules/hrms/salary-run.service";

/** Edit Present / Paid Leave / Extra Days / Arrears on a draft line (never touches attendance). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return hrmsRoute("hrms_salary_generate", "edit", (actor) => editSalaryLine(actor, id, editSalaryLineSchema.parse(body)));
}
