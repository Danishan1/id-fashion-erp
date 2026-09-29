import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { listBarcodes } from "@/core/barcode/barcode.service";

/** Backs the Barcode Management screen — search by code, filter by entity type/status. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "barcodes", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "createdAt");
    const entityType = req.nextUrl.searchParams.get("entityType")?.trim() || undefined;
    const { data, totalCount } = await listBarcodes({ companyId: session.user.companyId, userId: session.user.id }, { ...query, entityType });

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}
