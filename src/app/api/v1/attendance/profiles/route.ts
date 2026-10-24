import { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { listEmployeeAttendanceProfiles } from "@/modules/hrms/attendance-settings.service";

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.get("search") ?? undefined;
  return hrmsRoute("hrms_attendance", "edit", (actor) => listEmployeeAttendanceProfiles(actor.companyId, search));
}
