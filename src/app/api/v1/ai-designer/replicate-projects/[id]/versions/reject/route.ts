import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { rejectReplicateVersion } from "@/modules/ai-designer/replicate-design.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Top-toolbar "Reject Design" — the review counterpart to Approve; only changes the current version's own review status. */
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const version = await rejectReplicateVersion({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: version });
  } catch (error) {
    return handleApiError(error);
  }
}
