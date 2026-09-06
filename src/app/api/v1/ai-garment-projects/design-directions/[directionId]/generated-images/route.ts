import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { generateVisualsSchema } from "@/modules/ai-garment-flow/visual-generation.schema";
import { generateVisuals, listGeneratedImages } from "@/modules/ai-garment-flow/visual-generation.service";

interface RouteContext {
  params: Promise<{ directionId: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "view");

    const { directionId } = await params;
    const images = await listGeneratedImages(session.user.companyId, directionId);

    return NextResponse.json({ data: images });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { directionId } = await params;
    const input = generateVisualsSchema.parse(await req.json());
    const images = await generateVisuals({ companyId: session.user.companyId, userId: session.user.id }, directionId, input);

    return NextResponse.json({ data: images }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
