import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { purchaseOrderStatusChangeSchema } from "@/modules/purchasing/purchase-order.schema";
import { transitionPurchaseOrderStatus } from "@/modules/purchasing/purchase-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "purchase_order", "edit");

    const { id } = await params;
    const { status } = purchaseOrderStatusChangeSchema.parse(await req.json());
    const order = await transitionPurchaseOrderStatus(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      status
    );

    return NextResponse.json({ data: order });
  } catch (error) {
    return handleApiError(error);
  }
}
