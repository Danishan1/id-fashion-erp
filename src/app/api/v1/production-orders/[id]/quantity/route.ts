import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateProductionOrderQuantitySchema } from "@/modules/production/production.schema";
import { updateProductionOrderQuantity } from "@/modules/production/production-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Scoped sub-route, not the generic /status endpoint — a Production Order's
// quantity carries its own "no lots yet" business guard, separate from its
// status-transition rules.
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "edit");

    const { id } = await params;
    const { plannedQuantity } = updateProductionOrderQuantitySchema.parse(await req.json());
    const actor = { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId };

    const order = await updateProductionOrderQuantity(actor, id, plannedQuantity);

    return NextResponse.json({ data: order });
  } catch (error) {
    return handleApiError(error);
  }
}
