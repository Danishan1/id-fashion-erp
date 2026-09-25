import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createMaterialRequestFromShortfallSchema } from "@/modules/inventory/material-request.schema";
import { createMaterialRequestFromShortfall } from "@/modules/inventory/material-request.service";

// Asserts "inventory.create", not "bom_mrp.create" — this functionally
// creates a real MaterialRequest, and a user who can view MRP screens but
// lacks Inventory create rights shouldn't be able to back-door one through
// this button.
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "material_request", "create");

    const input = createMaterialRequestFromShortfallSchema.parse(await req.json());
    const request = await createMaterialRequestFromShortfall(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: request }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
