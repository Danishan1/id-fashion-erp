import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { listStockBalances } from "@/modules/inventory/inventory.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "updatedAt");
    const warehouseId = req.nextUrl.searchParams.get("warehouseId") || undefined;
    const { data, totalCount } = await listStockBalances(session.user.companyId, query, { warehouseId }, { includeLocationBreakdown: true });

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}
