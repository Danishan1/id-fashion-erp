import { NextRequest } from "next/server";
import { z } from "zod";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { attendanceLocationSchema } from "@/modules/hrms/attendance-settings.schema";
import { setAttendanceLocationActive, updateAttendanceLocation } from "@/modules/hrms/attendance-settings.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return hrmsRoute("hrms_attendance_settings", "edit", async (actor) => {
    const body = await req.json();
    // A body with only `isActive` is the list's Active/Inactive toggle.
    if (Object.keys(body ?? {}).length === 1 && "isActive" in body) {
      return setAttendanceLocationActive(actor, id, z.boolean().parse(body.isActive));
    }
    return updateAttendanceLocation(actor, id, attendanceLocationSchema.parse(body));
  });
}
