import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { warehouseSchema } from "@/modules/warehouses/warehouse.schema";
import { listWarehouses, createWarehouse } from "@/modules/warehouses/warehouse.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "name");
    const { data, totalCount } = await listWarehouses({ companyId: session.user.companyId, userId: session.user.id }, query);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "create");

    const input = warehouseSchema.parse(await req.json());
    const warehouse = await createWarehouse(
      { companyId: session.user.companyId, branchId: session.user.defaultBranchId, userId: session.user.id },
      input
    );

    return NextResponse.json({ data: warehouse }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
