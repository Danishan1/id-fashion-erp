import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateTechPackFieldSchema } from "@/modules/ai-designer/ai-designer.schema";
import { updateTechPackField } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string; techPackId: string }>;
}

/** Edits one field/row of a Tech Pack's Garment Analysis — forks a new revision first if the tech pack is already APPROVED (see updateTechPackField()). */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id, techPackId } = await params;
    const input = updateTechPackFieldSchema.parse(await req.json());
    const result = await updateTechPackField({ companyId: session.user.companyId, userId: session.user.id }, id, techPackId, input);

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
