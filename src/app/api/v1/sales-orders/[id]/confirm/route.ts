import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { confirmSalesOrderSchema } from "@/modules/sales-orders/sales-order.schema";
import { confirmSalesOrder } from "@/modules/sales-orders/sales-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sales_orders", "edit");

    const { id } = await params;
    const input = confirmSalesOrderSchema.parse(await req.json().catch(() => ({})));
    const order = await confirmSalesOrder(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      input
    );

    return NextResponse.json({ data: order });
  } catch (error) {
    return handleApiError(error);
  }
}
