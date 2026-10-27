import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { rejectAttendanceCorrectionSchema } from "@/modules/hrms/attendance-correction.schema";
import { rejectAttendanceCorrectionRequest } from "@/modules/hrms/attendance-correction.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "hrms_attendance_regularization", "reject");

    const { id } = await params;
    const input = rejectAttendanceCorrectionSchema.parse(await req.json());
    const request = await rejectAttendanceCorrectionRequest(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: request });
  } catch (error) {
    return handleApiError(error);
  }
}
