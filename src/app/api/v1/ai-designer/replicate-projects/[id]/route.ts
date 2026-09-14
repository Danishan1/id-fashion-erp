import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getReplicateProjectById } from "@/modules/ai-designer/replicate-design.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "view");

    const { id } = await params;
    const project = await getReplicateProjectById(session.user.companyId, id);

    return NextResponse.json({ data: project });
  } catch (error) {
    return handleApiError(error);
  }
}
