import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateLeaveTypeSchema } from "@/modules/hrms/leave.schema";
import { updateLeaveType } from "@/modules/hrms/leave.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "hrms_leave_types", "edit");

    const { id } = await params;
    const input = updateLeaveTypeSchema.parse(await req.json());
    const leaveType = await updateLeaveType(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: leaveType });
  } catch (error) {
    return handleApiError(error);
  }
}
