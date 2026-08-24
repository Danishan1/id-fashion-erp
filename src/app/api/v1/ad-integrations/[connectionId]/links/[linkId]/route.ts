import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { linkCampaignSchema } from "@/modules/marketing/ad-integrations/ad-integration.schema";
import { linkAdCampaign } from "@/modules/marketing/ad-integrations/ad-integration.service";

interface RouteContext {
  params: Promise<{ connectionId: string; linkId: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "marketing", "edit");

    const { connectionId, linkId } = await params;
    const input = linkCampaignSchema.parse(await req.json());

    const link = await linkAdCampaign(
      { companyId: session.user.companyId, userId: session.user.id },
      connectionId,
      linkId,
      input.localCampaignId
    );

    return NextResponse.json({ data: link });
  } catch (error) {
    return handleApiError(error);
  }
}
