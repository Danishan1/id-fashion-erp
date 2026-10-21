import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { createStockMovementSchema } from "@/modules/inventory/stock-movement.schema";
import { createStockMovement, listStockMovements } from "@/modules/inventory/stock-movement.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "createdAt");
    const params = req.nextUrl.searchParams;
    const { data, totalCount } = await listStockMovements({ companyId: session.user.companyId, userId: session.user.id }, query, {
      movementType: params.get("movementType")?.trim() || undefined,
      status: params.get("status")?.trim() || undefined,
      toWarehouseId: params.get("toWarehouseId")?.trim() || undefined,
    });

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "create");

    const input = createStockMovementSchema.parse(await req.json());
    const movement = await createStockMovement(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: movement }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
