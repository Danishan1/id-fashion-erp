import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { designVariationDecisionSchema } from "@/modules/ai-garment-flow/design-variation.schema";
import { decideDesignVariation } from "@/modules/ai-garment-flow/design-variation.service";

interface RouteContext {
  params: Promise<{ variationId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { variationId } = await params;
    const input = designVariationDecisionSchema.parse(await req.json());
    const variation = await decideDesignVariation({ companyId: session.user.companyId, userId: session.user.id }, variationId, input);

    return NextResponse.json({ data: variation });
  } catch (error) {
    return handleApiError(error);
  }
}
