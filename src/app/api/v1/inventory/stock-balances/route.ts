import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { listRawMaterialStock } from "@/modules/inventory/raw-material-stock.service";

/** Raw material stock, one row per material: total, reserved, available, rolls and colours. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "styleName");
    const warehouseId = req.nextUrl.searchParams.get("warehouseId") || undefined;
    const materialCategory = req.nextUrl.searchParams.get("materialCategory") || undefined;
    const showZeroStock = req.nextUrl.searchParams.get("showZeroStock") === "true";
    const { data, totalCount } = await listRawMaterialStock(session.user.companyId, query, { warehouseId, materialCategory, showZeroStock });

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}
