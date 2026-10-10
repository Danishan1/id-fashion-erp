import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateCampaignSchema } from "@/modules/marketing/campaign.schema";
import { getCampaignById, updateCampaign } from "@/modules/marketing/campaign.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "marketing", "view");

    const { id } = await params;
    const campaign = await getCampaignById(session.user.companyId, id);

    return NextResponse.json({ data: campaign });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "marketing", "edit");

    const { id } = await params;
    const input = updateCampaignSchema.parse(await req.json());
    const campaign = await updateCampaign(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: campaign });
  } catch (error) {
    return handleApiError(error);
  }
}
