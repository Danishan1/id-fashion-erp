import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listPieceRateEarnings } from "@/modules/production/piece-rate-earning.service";
import { getProductionSettings } from "@/core/production-settings/ProductionSettingsService";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "piece_rate", "view");

    const params = req.nextUrl.searchParams;
    let employeeId = params.get("employeeId") || undefined;

    // A plain PRODUCTION_WORKER (no piece_rate.approve/export) only ever
    // sees their OWN earnings, and only when the company setting allows it
    // — server-side scoped, never trusted from a client-supplied employeeId.
    const canSeeAll = await PermissionService.can(session.user.id, "piece_rate", "approve");
    if (!canSeeAll) {
      const settings = await getProductionSettings(session.user.companyId);
      if (!settings.workersCanViewOwnRate) {
        return NextResponse.json({ data: [] });
      }
      // Resolve the caller's own Employee id server-side.
      const { prisma } = await import("@/core/db/client");
      const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { employeeId: true } });
      employeeId = user?.employeeId ?? "__none__";
    }

    const data = await listPieceRateEarnings(session.user.companyId, {
      employeeId,
      supplierId: params.get("supplierId") || undefined,
      status: params.get("status") || undefined,
    });
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
