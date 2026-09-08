import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { resetMeasurementValueToAi } from "@/modules/ai-garment-flow/technical-specification.service";

interface RouteContext {
  params: Promise<{ valueId: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { valueId } = await params;
    const value = await resetMeasurementValueToAi({ companyId: session.user.companyId, userId: session.user.id }, valueId);

    return NextResponse.json({ data: value });
  } catch (error) {
    return handleApiError(error);
  }
}
