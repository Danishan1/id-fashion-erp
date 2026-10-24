import { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { attendanceLocationSchema } from "@/modules/hrms/attendance-settings.schema";
import { createAttendanceLocation, listAttendanceLocations } from "@/modules/hrms/attendance-settings.service";

export async function GET(req: NextRequest) {
  const activeOnly = req.nextUrl.searchParams.get("activeOnly") === "true";
  return hrmsRoute("hrms_attendance", "view", (actor) => listAttendanceLocations(actor.companyId, { activeOnly }));
}

export async function POST(req: NextRequest) {
  return hrmsRoute("hrms_attendance", "edit", async (actor) => createAttendanceLocation(actor, attendanceLocationSchema.parse(await req.json())), 201);
}
