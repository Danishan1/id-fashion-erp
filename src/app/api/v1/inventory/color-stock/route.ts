import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getStockColorBreakdown } from "@/modules/inventory/inventory.service";

const querySchema = z.object({ productId: z.string().uuid(), warehouseId: z.string().uuid() });

/** One material's stock at one warehouse, split by colour (plus "No colour"). */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const [canInventory, canMaterialRequest] = await Promise.all([
      PermissionService.can(session.user.id, "inventory", "view"),
      PermissionService.can(session.user.id, "material_request", "view"),
    ]);
    if (!canInventory && !canMaterialRequest) await PermissionService.assert(session.user.id, "inventory", "view");
    const { productId, warehouseId } = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    return NextResponse.json({ data: await getStockColorBreakdown(session.user.companyId, productId, warehouseId) });
  } catch (error) {
    return handleApiError(error);
  }
}
