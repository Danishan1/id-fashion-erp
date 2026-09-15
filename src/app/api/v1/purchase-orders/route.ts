import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { purchaseOrderSchema } from "@/modules/purchasing/purchase-order.schema";
import { createPurchaseOrder, listPurchaseOrders } from "@/modules/purchasing/purchase-order.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "purchasing", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "orderDate");
    const { data, totalCount } = await listPurchaseOrders({ companyId: session.user.companyId, userId: session.user.id }, query);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "purchasing", "create");

    const input = purchaseOrderSchema.parse(await req.json());
    const order = await createPurchaseOrder(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: order }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
