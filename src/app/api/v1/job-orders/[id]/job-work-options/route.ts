import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getJobWorkPlanningOptions } from "@/modules/production/job-work-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Coverable stages + their Style/Design default costs + free quantity, for the "Send to External Job-Work" form. */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "create");

    const { id } = await params;
    const data = await getJobWorkPlanningOptions(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
    );
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
