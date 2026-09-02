import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { warehouseLocationUpdateSchema } from "@/modules/warehouses/warehouse.schema";
import { updateWarehouseLocation } from "@/modules/warehouses/warehouse.service";

interface RouteContext {
  params: Promise<{ id: string; locationId: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id, locationId } = await params;
    const input = warehouseLocationUpdateSchema.parse(await req.json());
    const location = await updateWarehouseLocation(
      { companyId: session.user.companyId, branchId: session.user.defaultBranchId, userId: session.user.id },
      id,
      locationId,
      input
    );

    return NextResponse.json({ data: location });
  } catch (error) {
    return handleApiError(error);
  }
}
