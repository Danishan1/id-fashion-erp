import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { warehouseLocationSchema } from "@/modules/warehouses/warehouse.schema";
import { createWarehouseLocation, listWarehouseLocations } from "@/modules/warehouses/warehouse.service";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");

    const { id } = await params;
    const locations = await listWarehouseLocations(session.user.companyId, id);

    return NextResponse.json({ data: locations });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "create");

    const { id } = await params;
    const input = warehouseLocationSchema.parse(await req.json());
    const location = await createWarehouseLocation(
      { companyId: session.user.companyId, branchId: session.user.defaultBranchId, userId: session.user.id },
      id,
      input
    );

    return NextResponse.json({ data: location }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
