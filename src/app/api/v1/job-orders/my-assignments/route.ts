import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listMyProductionAssignments } from "@/modules/production/job-order.service";

// Static sibling of the [id] dynamic segment — same precedent as
// /api/v1/lots/merge alongside /api/v1/lots/[id].
export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view");

    const assignments = await listMyProductionAssignments({
      companyId: session.user.companyId,
      userId: session.user.id,
      branchId: session.user.defaultBranchId,
    });

    return NextResponse.json({ data: assignments });
  } catch (error) {
    return handleApiError(error);
  }
}
