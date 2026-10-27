import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createLeaveTypeSchema } from "@/modules/hrms/leave.schema";
import { createLeaveType, listLeaveTypes } from "@/modules/hrms/leave.service";

export async function GET() {
  try {
    const session = await requireSession();
    // The type list is also read by Leave Requests and Regularization (leave days).
    const readers = ["hrms_leave_types", "hrms_leave", "hrms_attendance_regularization"] as const;
    let canRead = false;
    for (const m of readers) if (!canRead && (await PermissionService.can(session.user.id, m, "view"))) canRead = true;
    if (!canRead) await PermissionService.assert(session.user.id, "hrms_leave_types", "view");

    const data = await listLeaveTypes(session.user.companyId);

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "hrms_leave_types", "create");

    const input = createLeaveTypeSchema.parse(await req.json());
    const leaveType = await createLeaveType(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: leaveType }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
