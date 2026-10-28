import type { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { cancelSalaryAdvance } from "@/modules/hrms/salary-advance.service";

/** Withdraw your own advance request before it is paid. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return hrmsRoute("hrms_salary_advance", "create", (actor) => cancelSalaryAdvance(actor, id));
}
