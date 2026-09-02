import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { setWarehouseLocationActiveStatus } from "@/modules/warehouses/warehouse.service";

const statusSchema = z.object({ isActive: z.boolean() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; locationId: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id, locationId } = await params;
    const { isActive } = statusSchema.parse(await req.json());
    const location = await setWarehouseLocationActiveStatus(
      { companyId: session.user.companyId, branchId: session.user.defaultBranchId, userId: session.user.id },
      id,
      locationId,
      isActive
    );

    return NextResponse.json({ data: location });
  } catch (error) {
    return handleApiError(error);
  }
}
