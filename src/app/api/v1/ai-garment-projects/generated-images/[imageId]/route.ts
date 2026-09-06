import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateImageNotesSchema } from "@/modules/ai-garment-flow/visual-generation.schema";
import { updateImageNotes } from "@/modules/ai-garment-flow/visual-generation.service";

interface RouteContext {
  params: Promise<{ imageId: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { imageId } = await params;
    const input = updateImageNotesSchema.parse(await req.json());
    const updated = await updateImageNotes({ companyId: session.user.companyId, userId: session.user.id }, imageId, input);

    return NextResponse.json({ data: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
