import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { resumePurchaseOrderFromHold } from "@/modules/purchasing/purchase-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "purchase_order", "edit");

    const { id } = await params;
    const order = await resumePurchaseOrderFromHold({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: order });
  } catch (error) {
    return handleApiError(error);
  }
}
