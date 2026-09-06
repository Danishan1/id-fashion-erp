import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createVariationSchema } from "@/modules/ai-garment-flow/visual-generation.schema";
import { createVariation } from "@/modules/ai-garment-flow/visual-generation.service";

interface RouteContext {
  params: Promise<{ imageId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { imageId } = await params;
    const input = createVariationSchema.parse(await req.json());
    const images = await createVariation({ companyId: session.user.companyId, userId: session.user.id }, imageId, input);

    return NextResponse.json({ data: images }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
