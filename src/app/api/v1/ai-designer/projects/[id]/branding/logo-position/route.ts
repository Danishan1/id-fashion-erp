import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateLogoPositionSchema } from "@/modules/ai-designer/ai-designer.schema";
import { updateLogoPosition } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Called on pointer-up while dragging/resizing the logo overlay — not on every intermediate move. */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const input = updateLogoPositionSchema.parse(await req.json());
    const project = await updateLogoPosition({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: project });
  } catch (error) {
    return handleApiError(error);
  }
}
