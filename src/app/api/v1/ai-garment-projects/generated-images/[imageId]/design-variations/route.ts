import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createDesignVariationSchema } from "@/modules/ai-garment-flow/design-variation.schema";
import { createDesignVariation, listDesignVariations } from "@/modules/ai-garment-flow/design-variation.service";

interface RouteContext {
  params: Promise<{ imageId: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "view");

    const { imageId } = await params;
    const variations = await listDesignVariations(session.user.companyId, imageId);

    return NextResponse.json({ data: variations });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { imageId } = await params;
    const input = createDesignVariationSchema.parse(await req.json());
    const variation = await createDesignVariation({ companyId: session.user.companyId, userId: session.user.id }, imageId, input);

    return NextResponse.json({ data: variation }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
