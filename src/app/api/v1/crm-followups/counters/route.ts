import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getFollowupCounters } from "@/modules/crm/crm-activity.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "view");

    const counters = await getFollowupCounters(session.user.companyId);

    return NextResponse.json({ data: counters });
  } catch (error) {
    return handleApiError(error);
  }
}
