import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getAttendanceSummaryForDate } from "@/modules/hrms/attendance.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "hrms_attendance_team", "view");

    const date = req.nextUrl.searchParams.get("date");
    if (!date) throw new BusinessRuleError("VALIDATION_ERROR", "date is required.", {});

    const summary = await getAttendanceSummaryForDate({ companyId: session.user.companyId, userId: session.user.id }, date);

    return NextResponse.json({ data: summary });
  } catch (error) {
    return handleApiError(error);
  }
}
