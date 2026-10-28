import type { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { requestSalaryAdvanceSchema } from "@/modules/hrms/salary-advance.schema";
import { listSalaryAdvances, requestSalaryAdvance } from "@/modules/hrms/salary-advance.service";

export function GET() {
  return hrmsRoute("hrms_salary_advance", "view", (actor) => listSalaryAdvances(actor));
}

/** The caller asks for an advance for themselves (never for someone else). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return hrmsRoute("hrms_salary_advance", "create", (actor) => requestSalaryAdvance(actor, requestSalaryAdvanceSchema.parse(body)), 201);
}
