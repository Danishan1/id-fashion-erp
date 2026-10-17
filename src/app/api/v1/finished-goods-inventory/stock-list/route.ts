import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { listFinishedGoodsStockBalances } from "@/modules/finished-goods-inventory/finished-goods-stock-list.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "fg_inventory", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "updatedAt");
    const params = req.nextUrl.searchParams;
    const filters = {
      productId: params.get("productId") || undefined,
      colorId: params.get("colorId") || undefined,
      sizeId: params.get("sizeId") || undefined,
      warehouseId: params.get("warehouseId") || undefined,
      warehouseLocationId: params.get("warehouseLocationId") || undefined,
    };

    const { data, totalCount } = await listFinishedGoodsStockBalances(session.user.companyId, query, filters);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}
