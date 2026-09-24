import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getActiveReplicateEditPreview } from "@/modules/ai-designer/replicate-design.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Replicate Design's own mirror of AI Designer's projects/[id]/edit-preview route — see that route's comment. */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "view");

    const { id } = await params;
    const preview = await getActiveReplicateEditPreview(session.user.companyId, id);

    return NextResponse.json({ data: preview });
  } catch (error) {
    return handleApiError(error);
  }
}
