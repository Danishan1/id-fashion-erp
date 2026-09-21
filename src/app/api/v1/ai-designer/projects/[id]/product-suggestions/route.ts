import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getProductSuggestions, runProductSuggestions } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Step 2b — run the real AI text call suggesting prioritized garments per suitable customer segment. */
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const project = await runProductSuggestions({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: project });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "view");

    const { id } = await params;
    const suggestions = await getProductSuggestions(session.user.companyId, id);

    return NextResponse.json({ data: suggestions });
  } catch (error) {
    return handleApiError(error);
  }
}
