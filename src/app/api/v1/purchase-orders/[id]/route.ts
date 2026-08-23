import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updatePurchaseOrderSchema } from "@/modules/purchasing/purchase-order.schema";
import { getPurchaseOrderById, updatePurchaseOrder } from "@/modules/purchasing/purchase-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "purchasing", "view");

    const { id } = await params;
    const order = await getPurchaseOrderById(session.user.companyId, id);

    return NextResponse.json({ data: order });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "purchasing", "edit");

    const { id } = await params;
    const input = updatePurchaseOrderSchema.parse(await req.json());
    const order = await updatePurchaseOrder(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: order });
  } catch (error) {
    return handleApiError(error);
  }
}
