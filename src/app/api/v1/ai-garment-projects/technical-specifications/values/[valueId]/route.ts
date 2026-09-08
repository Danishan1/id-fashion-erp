import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateMeasurementValueSchema } from "@/modules/ai-garment-flow/technical-specification.schema";
import { updateMeasurementValue } from "@/modules/ai-garment-flow/technical-specification.service";

interface RouteContext {
  params: Promise<{ valueId: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { valueId } = await params;
    const input = updateMeasurementValueSchema.parse(await req.json());
    const value = await updateMeasurementValue({ companyId: session.user.companyId, userId: session.user.id }, valueId, input);

    return NextResponse.json({ data: value });
  } catch (error) {
    return handleApiError(error);
  }
}
