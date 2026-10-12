import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listReadyForDispatch } from "@/modules/production/dispatch-readiness.service";

/** Production orders whose pieces are all finished and still have quantity left to ship. */
export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "dispatch", "view");
    const data = await listReadyForDispatch({ companyId: session.user.companyId, userId: session.user.id });
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
