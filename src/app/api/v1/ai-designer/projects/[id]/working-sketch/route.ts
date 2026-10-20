import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { setWorkingSketchSchema } from "@/modules/ai-designer/new-design.schema";
import { setCurrentSketch } from "@/modules/ai-designer/new-design.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Undo on the edit page: make an earlier sketch of this design the working sketch again. */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");
    const { id } = await params;
    const { attachmentId } = setWorkingSketchSchema.parse(await req.json());
    const data = await setCurrentSketch({ companyId: session.user.companyId, userId: session.user.id }, id, attachmentId);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
