import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { skipProductSuggestions } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Explicit "Skip this step" — marks AI Product Suggestions complete with no AI call, since the step was already skippable via Next but never showed as done. */
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const project = await skipProductSuggestions({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: project });
  } catch (error) {
    return handleApiError(error);
  }
}
