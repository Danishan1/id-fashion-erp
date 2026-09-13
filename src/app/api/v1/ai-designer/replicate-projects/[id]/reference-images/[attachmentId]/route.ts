import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { deleteReferenceImage } from "@/modules/ai-designer/replicate-design.service";

interface RouteContext {
  params: Promise<{ id: string; attachmentId: string }>;
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id, attachmentId } = await params;
    const project = await deleteReferenceImage({ companyId: session.user.companyId, userId: session.user.id }, id, attachmentId);

    return NextResponse.json({ data: project });
  } catch (error) {
    return handleApiError(error);
  }
}
