import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { resetFabricObservationToAi } from "@/modules/ai-garment-flow/fabric-analysis.service";

interface RouteContext {
  params: Promise<{ observationId: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { observationId } = await params;
    const observation = await resetFabricObservationToAi(
      { companyId: session.user.companyId, userId: session.user.id },
      observationId
    );

    return NextResponse.json({ data: observation });
  } catch (error) {
    return handleApiError(error);
  }
}
