import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { addAttributionSchema } from "@/modules/marketing/campaign.schema";
import { addAttribution } from "@/modules/marketing/campaign.service";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "marketing", "edit");

    const input = addAttributionSchema.parse(await req.json());
    const attribution = await addAttribution(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: attribution }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
