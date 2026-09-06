import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateObservationSchema } from "@/modules/ai-garment-flow/reference-analysis.schema";
import { updateObservation } from "@/modules/ai-garment-flow/reference-analysis.service";

interface RouteContext {
  params: Promise<{ observationId: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { observationId } = await params;
    const input = updateObservationSchema.parse(await req.json());
    const observation = await updateObservation(
      { companyId: session.user.companyId, userId: session.user.id },
      observationId,
      input.approvedObservation
    );

    return NextResponse.json({ data: observation });
  } catch (error) {
    return handleApiError(error);
  }
}
