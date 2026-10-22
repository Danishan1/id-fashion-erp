import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getRawMaterialStockByLocation } from "@/modules/inventory/inventory.service";

const querySchema = z.object({ productId: z.string().uuid(), warehouseId: z.string().uuid() });

/** Which locations of a warehouse hold a raw material, and how much — feeds the Send page's location picker. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "view");
    const { productId, warehouseId } = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const data = await getRawMaterialStockByLocation(session.user.companyId, productId, warehouseId);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
