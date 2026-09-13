import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createMaterialRequestFromSampleVersionSchema } from "@/modules/inventory/material-request.schema";
import { createMaterialRequestFromSampleVersion } from "@/modules/inventory/material-request.service";

interface RouteContext {
  params: Promise<{ versionId: string }>;
}

// Asserts "inventory.create", not "sampling.edit" — same reasoning as
// BOM/MRP's own generate-material-request route: this functionally creates
// a real MaterialRequest, so it needs the permission that action actually
// requires, not just whatever the calling screen happens to sit under.
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "create");

    const { versionId } = await params;
    const input = createMaterialRequestFromSampleVersionSchema.parse(await req.json());
    const request = await createMaterialRequestFromSampleVersion(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      { sampleVersionId: versionId, warehouseId: input.warehouseId, overrideDuplicateCheck: input.overrideDuplicateCheck }
    );

    return NextResponse.json({ data: request }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
