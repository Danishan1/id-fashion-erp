import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { resumeSalesOrderFromHold } from "@/modules/sales-orders/sales-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sales_orders", "edit");

    const { id } = await params;
    const order = await resumeSalesOrderFromHold(
      { companyId: session.user.companyId, userId: session.user.id },
      id
    );

    return NextResponse.json({ data: order });
  } catch (error) {
    return handleApiError(error);
  }
}
