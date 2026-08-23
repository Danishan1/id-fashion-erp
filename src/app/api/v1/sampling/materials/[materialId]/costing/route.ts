import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { sampleMaterialCostingSchema } from "@/modules/sampling/sample.schema";
import { recordSampleMaterialCosting } from "@/modules/sampling/sample.service";

interface RouteContext {
  params: Promise<{ materialId: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "edit");

    const { materialId } = await params;
    const input = sampleMaterialCostingSchema.parse(await req.json());
    const materials = await recordSampleMaterialCosting(
      { companyId: session.user.companyId, userId: session.user.id },
      materialId,
      input
    );

    return NextResponse.json({ data: materials });
  } catch (error) {
    return handleApiError(error);
  }
}
