import type { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { removeAdjustmentSchema } from "@/modules/hrms/salary-attendance.schema";
import { removeSalaryAdjustment } from "@/modules/hrms/salary-attendance.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return hrmsRoute("hrms_salary_attendance", "edit", (actor) => removeSalaryAdjustment(actor, id, removeAdjustmentSchema.parse(body).reason || undefined));
}
