import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { imageDecisionSchema } from "@/modules/ai-garment-flow/visual-generation.schema";
import { decideImage } from "@/modules/ai-garment-flow/visual-generation.service";

interface RouteContext {
  params: Promise<{ imageId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { imageId } = await params;
    const input = imageDecisionSchema.parse(await req.json());
    const updated = await decideImage({ companyId: session.user.companyId, userId: session.user.id }, imageId, input);

    return NextResponse.json({ data: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
