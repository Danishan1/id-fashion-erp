import type { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { sendSalaryRunToAccounts } from "@/modules/hrms/salary-payout.service";

/** Post the month's accrual journal and raise one SALARY payment request per employee (safe to repeat). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return hrmsRoute("hrms_salary_generate", "post", (actor) => sendSalaryRunToAccounts(actor, id));
}
