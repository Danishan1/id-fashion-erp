import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { resetSuitabilityItemToAi } from "@/modules/ai-garment-flow/product-suitability.service";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { itemId } = await params;
    const item = await resetSuitabilityItemToAi(
      { companyId: session.user.companyId, userId: session.user.id },
      itemId
    );

    return NextResponse.json({ data: item });
  } catch (error) {
    return handleApiError(error);
  }
}
