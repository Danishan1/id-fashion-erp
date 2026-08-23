import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateSalesOrderSchema } from "@/modules/sales-orders/sales-order.schema";
import { getSalesOrderById, updateSalesOrder } from "@/modules/sales-orders/sales-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sales_orders", "view");

    const { id } = await params;
    const order = await getSalesOrderById(session.user.companyId, id);

    return NextResponse.json({ data: order });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sales_orders", "edit");

    const { id } = await params;
    const input = updateSalesOrderSchema.parse(await req.json());
    const order = await updateSalesOrder({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: order });
  } catch (error) {
    return handleApiError(error);
  }
}
