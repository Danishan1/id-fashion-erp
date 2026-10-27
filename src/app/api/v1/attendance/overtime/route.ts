import { NextRequest } from "next/server";
import type { AttendanceOvertimeStatus } from "@prisma/client";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { listOvertime } from "@/modules/hrms/overtime.service";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const status = p.get("status");
  // Own overtime (My Attendance) needs only My Attendance; the review list needs Overtime.
  const mine = p.get("mine") === "true";
  return hrmsRoute(mine ? "hrms_attendance" : "hrms_attendance_overtime", "view", (actor) =>
    listOvertime(actor, {
      month: p.get("month") || undefined,
      status: status && ["PENDING", "APPROVED", "REJECTED"].includes(status) ? (status as AttendanceOvertimeStatus) : undefined,
      employeeId: p.get("employeeId") || undefined,
      mine,
    })
  );
}
