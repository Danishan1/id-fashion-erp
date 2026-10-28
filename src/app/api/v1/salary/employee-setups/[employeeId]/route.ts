import type { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { employeeSalarySetupSchema } from "@/modules/hrms/salary-setup.schema";
import { getEmployeeSalarySetup, saveEmployeeSalarySetup } from "@/modules/hrms/salary-setup.service";

interface RouteContext {
  params: Promise<{ employeeId: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { employeeId } = await params;
  return hrmsRoute("hrms_salary_setup", "view", (actor) => getEmployeeSalarySetup(actor.companyId, employeeId));
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  const { employeeId } = await params;
  const body = await req.json().catch(() => ({}));
  return hrmsRoute("hrms_salary_setup", "edit", (actor) => saveEmployeeSalarySetup(actor, employeeId, employeeSalarySetupSchema.parse(body)));
}
