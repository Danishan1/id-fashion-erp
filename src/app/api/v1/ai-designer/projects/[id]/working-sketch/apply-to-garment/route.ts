import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { applyWorkingSketchToGarment } from "@/modules/ai-designer/new-design.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Edit page, Options tab: render the garment from the edited working sketch as a new version. */
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");
    const { id } = await params;
    const data = await applyWorkingSketchToGarment({ companyId: session.user.companyId, userId: session.user.id }, id);
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
