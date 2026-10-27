import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { approveAttendanceCorrectionRequest } from "@/modules/hrms/attendance-correction.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "hrms_attendance_regularization", "approve");

    const { id } = await params;
    const request = await approveAttendanceCorrectionRequest(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id
    );

    return NextResponse.json({ data: request });
  } catch (error) {
    return handleApiError(error);
  }
}
