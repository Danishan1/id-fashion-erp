import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { resetDnaObservationToAi } from "@/modules/ai-designer/replicate-design.service";

interface RouteContext {
  params: Promise<{ id: string; observationId: string }>;
}

export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { observationId } = await params;
    const observation = await resetDnaObservationToAi({ companyId: session.user.companyId, userId: session.user.id }, observationId);

    return NextResponse.json({ data: observation });
  } catch (error) {
    return handleApiError(error);
  }
}
