import { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { applyWeekendsSchema } from "@/modules/hrms/attendance-settings.schema";
import { applyWeekendsToAll } from "@/modules/hrms/attendance-settings.service";

export async function POST(req: NextRequest) {
  return hrmsRoute("hrms_attendance_settings", "edit", async (actor) => applyWeekendsToAll(actor, applyWeekendsSchema.parse(await req.json()).weekends));
}
