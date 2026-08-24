import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { generateFollowupNotifications } from "@/modules/crm/crm-activity.service";

export async function POST() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "edit");

    const result = await generateFollowupNotifications(session.user.companyId);

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
