import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getFinishedGoodsStyleStockBreakdown } from "@/modules/finished-goods-inventory/finished-goods-style-stock.service";

/** One style's Finished Goods stock by colour and size, plus warehouse-wise. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "fg_inventory", "view");

    const { productId } = await params;
    const warehouseId = req.nextUrl.searchParams.get("warehouseId") || undefined;
    const data = await getFinishedGoodsStyleStockBreakdown(session.user.companyId, productId, { warehouseId });

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
