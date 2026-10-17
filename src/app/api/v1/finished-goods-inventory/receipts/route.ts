import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { listFinishedGoodsReceipts } from "@/modules/finished-goods-inventory/finished-goods-receipt-list.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "fg_inventory", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "postedAt");
    const params = req.nextUrl.searchParams;
    const filters = {
      productId: params.get("productId") || undefined,
      warehouseId: params.get("warehouseId") || undefined,
    };

    const { data, totalCount } = await listFinishedGoodsReceipts(session.user.companyId, query, filters);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}
