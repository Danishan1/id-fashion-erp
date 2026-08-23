import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { generateMaterialRequestSchema } from "@/modules/production/production.schema";
import { generateMaterialRequestForOrder } from "@/modules/production/production-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Asserts "inventory.create" (not "production.edit") since this creates a
// real MaterialRequest — the permission the action actually needs, matching
// the same discipline already used by BOM/MRP's own "Generate Material
// Request" button.
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "create");

    const { id } = await params;
    const input = generateMaterialRequestSchema.parse(await req.json());
    const request = await generateMaterialRequestForOrder(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: request }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
