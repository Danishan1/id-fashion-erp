import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { generateSketchForImage } from "@/modules/ai-designer/new-design.service";

interface RouteContext {
  params: Promise<{ id: string; imageId: string }>;
}

/** (Re)generate the CAD sketch for one garment design. */
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");
    const { id, imageId } = await params;
    const data = await generateSketchForImage({ companyId: session.user.companyId, userId: session.user.id }, id, imageId);
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
