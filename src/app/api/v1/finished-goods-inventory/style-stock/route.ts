import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { listFinishedGoodsStyleStock } from "@/modules/finished-goods-inventory/finished-goods-style-stock.service";

/** Finished Goods stock, one row per style. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "fg_inventory", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "styleName");
    const warehouseId = req.nextUrl.searchParams.get("warehouseId") || undefined;
    const showZeroStock = req.nextUrl.searchParams.get("showZeroStock") === "true";
    const { data, totalCount } = await listFinishedGoodsStyleStock(session.user.companyId, query, { warehouseId, showZeroStock });

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}
