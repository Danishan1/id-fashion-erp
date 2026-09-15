import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { generateReplicateTechPack, getLatestReplicateTechPack } from "@/modules/ai-designer/replicate-design.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "view");

    const { id } = await params;
    const techPack = await getLatestReplicateTechPack(session.user.companyId, id);

    return NextResponse.json({ data: techPack });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Tech Pack — graded measurements + draft BOM + a technical flat sketch, all from the project's own current generated design, one action. */
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const result = await generateReplicateTechPack({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
