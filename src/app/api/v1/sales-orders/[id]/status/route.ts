import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { salesOrderStatusChangeSchema } from "@/modules/sales-orders/sales-order.schema";
import { transitionSalesOrderStatus } from "@/modules/sales-orders/sales-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sales_orders", "edit");

    const { id } = await params;
    const { status } = salesOrderStatusChangeSchema.parse(await req.json());
    const order = await transitionSalesOrderStatus(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      status
    );

    return NextResponse.json({ data: order });
  } catch (error) {
    return handleApiError(error);
  }
}
