import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { crmFollowupStatusChangeSchema } from "@/modules/crm/crm-activity.schema";
import { changeCrmFollowupStatus } from "@/modules/crm/crm-activity.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "edit");

    const { id } = await params;
    const input = crmFollowupStatusChangeSchema.parse(await req.json());
    const followup = await changeCrmFollowupStatus(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: followup });
  } catch (error) {
    return handleApiError(error);
  }
}
