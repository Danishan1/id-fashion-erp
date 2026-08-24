import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listFollowupsForManagement } from "@/modules/crm/crm-activity.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "view");

    const buckets = await listFollowupsForManagement(session.user.companyId);

    return NextResponse.json({ data: buckets });
  } catch (error) {
    return handleApiError(error);
  }
}
