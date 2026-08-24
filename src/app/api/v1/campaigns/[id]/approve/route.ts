import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { approveCampaign } from "@/modules/marketing/campaign.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// No PermissionService.assert here — approveCampaign() itself asserts
// "marketing"."approve" with the self-approval resourceContext, since the
// check depends on the campaign's own createdByUserId, not just the route.
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const campaign = await approveCampaign(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id
    );

    return NextResponse.json({ data: campaign });
  } catch (error) {
    return handleApiError(error);
  }
}
