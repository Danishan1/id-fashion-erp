import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { runLeaveCarryForwardSchema } from "@/modules/hrms/leave.schema";
import { listLeaveCarryForwards, runLeaveCarryForward } from "@/modules/hrms/leave.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "hrms_leave", "view");

    const toYearParam = req.nextUrl.searchParams.get("toYear");
    const data = await listLeaveCarryForwards(session.user.companyId, toYearParam ? Number(toYearParam) : undefined);

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Manually-triggered — this project has no job runner (see
 * LeaveBalanceCarryForward's own schema comment). Gated on "approve" (not
 * "edit") since this is a year-end policy action, not routine data entry —
 * only MANAGEMENT holds hrms_leave.approve today.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "hrms_leave", "approve");

    const input = runLeaveCarryForwardSchema.parse(await req.json());
    const result = await runLeaveCarryForward(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input.fromYear
    );

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
