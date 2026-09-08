import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateFabricObservationSchema } from "@/modules/ai-garment-flow/fabric-analysis.schema";
import { updateFabricObservation } from "@/modules/ai-garment-flow/fabric-analysis.service";

interface RouteContext {
  params: Promise<{ observationId: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { observationId } = await params;
    const input = updateFabricObservationSchema.parse(await req.json());
    const observation = await updateFabricObservation(
      { companyId: session.user.companyId, userId: session.user.id },
      observationId,
      input.approvedObservation
    );

    return NextResponse.json({ data: observation });
  } catch (error) {
    return handleApiError(error);
  }
}
