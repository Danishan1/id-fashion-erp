import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createLeaveTypeSchema } from "@/modules/hrms/leave.schema";
import { createLeaveType, listLeaveTypes } from "@/modules/hrms/leave.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "hrms_leave", "view");

    const data = await listLeaveTypes(session.user.companyId);

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "hrms_leave", "create");

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
