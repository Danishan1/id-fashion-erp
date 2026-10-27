import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { recordAttendanceSchema } from "@/modules/hrms/attendance.schema";
import { listAttendance, recordAttendance } from "@/modules/hrms/attendance.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "hrms_attendance_team", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "attendanceDate");
    const attendanceDate = req.nextUrl.searchParams.get("date") ?? undefined;
    const { data, totalCount } = await listAttendance({ companyId: session.user.companyId, userId: session.user.id }, query, attendanceDate);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "hrms_attendance_team", "create");

    const input = recordAttendanceSchema.parse(await req.json());
    const record = await recordAttendance(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: record }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
