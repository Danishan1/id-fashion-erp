import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { decideImageSchema } from "@/modules/ai-designer/ai-designer.schema";
import { decideImage } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string; imageId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { imageId } = await params;
    const input = decideImageSchema.parse(await req.json());
    const image = await decideImage({ companyId: session.user.companyId, userId: session.user.id }, imageId, input);

    return NextResponse.json({ data: image });
  } catch (error) {
    return handleApiError(error);
  }
}
