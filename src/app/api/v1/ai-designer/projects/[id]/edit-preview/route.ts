import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getActiveEditPreview } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Restores the Edit Design workspace's "AI Variations" tab on page load —
 * returns the most recent still-PENDING edit generation (QUICK/TECHNICAL/
 * AI_PROMPT/MASK) for the project's current image, or `{ data: null }` if
 * there is nothing to restore.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "view");

    const { id } = await params;
    const preview = await getActiveEditPreview(session.user.companyId, id);

    return NextResponse.json({ data: preview });
  } catch (error) {
    return handleApiError(error);
  }
}
