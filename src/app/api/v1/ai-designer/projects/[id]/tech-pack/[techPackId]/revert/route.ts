import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { revertTechPackToOriginal } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string; techPackId: string }>;
}

/** Discards every edit since generation, restoring the frozen AI-original snapshot — blocked once approved. */
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id, techPackId } = await params;
    const result = await revertTechPackToOriginal({ companyId: session.user.companyId, userId: session.user.id }, id, techPackId);

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
