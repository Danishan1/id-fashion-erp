import { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { employeeAttendanceProfileSchema } from "@/modules/hrms/attendance-settings.schema";
import { upsertEmployeeAttendanceProfile } from "@/modules/hrms/attendance-settings.service";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await params;
  return hrmsRoute("hrms_attendance", "edit", async (actor) => upsertEmployeeAttendanceProfile(actor, employeeId, employeeAttendanceProfileSchema.parse(await req.json())));
}
