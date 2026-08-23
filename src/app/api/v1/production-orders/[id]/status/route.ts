import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { productionOrderStatusChangeSchema } from "@/modules/production/production.schema";
import { closeProductionOrder, transitionProductionOrderStatus } from "@/modules/production/production-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "edit");

    const { id } = await params;
    const { status } = productionOrderStatusChangeSchema.parse(await req.json());
    const actor = { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId };

    const order = status === "CLOSED" ? await closeProductionOrder(actor, id) : await transitionProductionOrderStatus(actor, id, status);

    return NextResponse.json({ data: order });
  } catch (error) {
    return handleApiError(error);
  }
}
