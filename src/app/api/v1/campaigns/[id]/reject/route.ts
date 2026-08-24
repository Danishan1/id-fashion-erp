import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { rejectCampaignSchema } from "@/modules/marketing/campaign.schema";
import { rejectCampaign } from "@/modules/marketing/campaign.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// No PermissionService.assert here — rejectCampaign() itself asserts
// "marketing"."reject" (not self-approval-guarded, see the service's own
// comment on why rejecting doesn't carry the same self-dealing risk).
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const input = rejectCampaignSchema.parse(await req.json());
    const campaign = await rejectCampaign(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: campaign });
  } catch (error) {
    return handleApiError(error);
  }
}
