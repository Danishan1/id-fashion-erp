import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { warehouseSchema } from "@/modules/warehouses/warehouse.schema";
import { getWarehouseById, updateWarehouse } from "@/modules/warehouses/warehouse.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters", "view");

    const { id } = await params;
    const warehouse = await getWarehouseById(session.user.companyId, id);
    return NextResponse.json({ data: warehouse });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters", "edit");

    const { id } = await params;
    const input = warehouseSchema.parse(await req.json());
    const warehouse = await updateWarehouse(
      { companyId: session.user.companyId, branchId: session.user.defaultBranchId, userId: session.user.id },
      id,
      input
    );

    return NextResponse.json({ data: warehouse });
  } catch (error) {
    return handleApiError(error);
  }
}
