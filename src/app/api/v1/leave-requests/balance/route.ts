import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getLeaveBalance } from "@/modules/hrms/leave.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "hrms_leave", "view");

    const employeeId = req.nextUrl.searchParams.get("employeeId");
    const leaveTypeId = req.nextUrl.searchParams.get("leaveTypeId");
    const year = req.nextUrl.searchParams.get("year");
    if (!employeeId || !leaveTypeId) throw new BusinessRuleError("VALIDATION_ERROR", "employeeId and leaveTypeId are required.", {});

    const balance = await getLeaveBalance(session.user.companyId, employeeId, leaveTypeId, year ? Number(year) : new Date().getFullYear());

    return NextResponse.json({ data: balance });
  } catch (error) {
    return handleApiError(error);
  }
}
