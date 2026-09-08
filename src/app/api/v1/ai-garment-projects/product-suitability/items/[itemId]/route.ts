import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateSuitabilityItemSchema } from "@/modules/ai-garment-flow/product-suitability.schema";
import { updateSuitabilityItem } from "@/modules/ai-garment-flow/product-suitability.service";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { itemId } = await params;
    const input = updateSuitabilityItemSchema.parse(await req.json());
    const item = await updateSuitabilityItem(
      { companyId: session.user.companyId, userId: session.user.id },
      itemId,
      input.approvedRating
    );

    return NextResponse.json({ data: item });
  } catch (error) {
    return handleApiError(error);
  }
}
