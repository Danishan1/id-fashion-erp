import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getLotById } from "@/modules/production/lot.service";
import { getProductionHistory, getStageTimeline } from "@/modules/production/production-timeline.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Stage-wise timeline + dated movement history (audit trail). */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    // P1: planning/history detail -- needs production.view_all (workers only see their own cards).
    await PermissionService.assert(session.user.id, "production", "view_all");

    const { id } = await params;
    // Same company + branch + stage visibility rules as the lot page itself.
    await getLotById(session.user.companyId, id, session.user.id);
    const scope = { lotId: id };
    const [stages, history] = await Promise.all([
      getStageTimeline(session.user.companyId, scope),
      getProductionHistory(session.user.companyId, scope),
    ]);

    return NextResponse.json({ data: { stages, history } });
  } catch (error) {
    return handleApiError(error);
  }
}
