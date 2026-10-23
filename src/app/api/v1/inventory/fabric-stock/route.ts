import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { listFabricStock } from "@/modules/inventory/fabric-stock.service";

/** Fabric stock per fabric: total, reserved, available and roll count. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "styleName");
    const warehouseId = req.nextUrl.searchParams.get("warehouseId") || undefined;
    const { data, totalCount } = await listFabricStock(session.user.companyId, query, { warehouseId });

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}
