import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getProductionOrderById } from "@/modules/production/production-order.service";
import { getProductionHistory, getStageTimeline } from "@/modules/production/production-timeline.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Stage-wise timeline + dated movement history (audit trail). */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view");

    const { id } = await params;
    // Same company + branch visibility rules as the production order page itself.
    await getProductionOrderById({ companyId: session.user.companyId, userId: session.user.id }, id);
    const scope = { productionOrderId: id };
    const [stages, history] = await Promise.all([
      getStageTimeline(session.user.companyId, scope),
      getProductionHistory(session.user.companyId, scope),
    ]);

    return NextResponse.json({ data: { stages, history } });
  } catch (error) {
    return handleApiError(error);
  }
}
