import { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { updateAttendanceSettingsSchema } from "@/modules/hrms/attendance-settings.schema";
import { getAttendanceSettings, updateAttendanceSettings } from "@/modules/hrms/attendance-settings.service";

export async function GET() {
  return hrmsRoute("hrms_attendance", "view", (actor) => getAttendanceSettings(actor.companyId));
}

export async function PUT(req: NextRequest) {
  return hrmsRoute("hrms_attendance", "edit", async (actor) => updateAttendanceSettings(actor, updateAttendanceSettingsSchema.parse(await req.json())));
}
