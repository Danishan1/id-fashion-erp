import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listMySubmittedProgressEntries } from "@/modules/production/job-order.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view");

    const entries = await listMySubmittedProgressEntries({
      companyId: session.user.companyId,
      userId: session.user.id,
      branchId: session.user.defaultBranchId,
    });

    return NextResponse.json({ data: entries });
  } catch (error) {
    return handleApiError(error);
  }
}
