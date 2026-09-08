import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { sampleMaterialUpdateSchema } from "@/modules/sampling/sample.schema";
import { updateSampleMaterial } from "@/modules/sampling/sample.service";

interface RouteContext {
  params: Promise<{ materialId: string }>;
}

// Edits a material line's own core fields (material/quantity/unit/color/shade/
// notes) — distinct from the damage/costing sub-routes alongside this file,
// which only ever touch their own narrow field group.
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "edit");

    const { materialId } = await params;
    const input = sampleMaterialUpdateSchema.parse(await req.json());
    const materials = await updateSampleMaterial({ companyId: session.user.companyId, userId: session.user.id }, materialId, input);

    return NextResponse.json({ data: materials });
  } catch (error) {
    return handleApiError(error);
  }
}
