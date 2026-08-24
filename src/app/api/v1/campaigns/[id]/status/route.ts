import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { campaignStatusChangeSchema } from "@/modules/marketing/campaign.schema";
import { changeCampaignStatus } from "@/modules/marketing/campaign.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "marketing", "edit");

    const { id } = await params;
    const input = campaignStatusChangeSchema.parse(await req.json());
    const campaign = await changeCampaignStatus(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: campaign });
  } catch (error) {
    return handleApiError(error);
  }
}
