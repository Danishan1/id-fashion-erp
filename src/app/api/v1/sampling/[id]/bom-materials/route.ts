import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { sampleBomUpdateSchema } from "@/modules/sampling/sample.schema";
import { updateSampleBomMaterials } from "@/modules/sampling/sample.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// "Update BOM" — bulk-confirms the actual raw-material quantities used
// during sampling, once the sample is Approved. Gated on the ordinary
// "edit" action, same as every other scoped material sub-route in this
// module (add/damage/costing) — this only ever touches the sample's own
// material list, never the Style's real BOM, so it carries no more risk
// than any other material edit.
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "edit");

    const { id } = await params;
    const input = sampleBomUpdateSchema.parse(await req.json());
    const materials = await updateSampleBomMaterials(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: materials });
  } catch (error) {
    return handleApiError(error);
  }
}
