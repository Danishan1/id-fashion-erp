import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { assertProductionOrderInScope } from "@/modules/production/production-scope";
import { getLotMaterialReadiness } from "@/modules/production/lot-readiness.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Preview of the Production Lot material gate for a lot of `?quantity=` pieces
 * (0 = check the existing lots only, e.g. before starting a PLANNED lot).
 * Read-only — createLot/startLot enforce the same numbers server-side.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    // P1: planning/history detail -- needs production.view_all (workers only see their own cards).
    await PermissionService.assert(session.user.id, "production", "view_all");

    const { id } = await params;
    await assertProductionOrderInScope({ companyId: session.user.companyId, userId: session.user.id }, id);
    const quantity = Number(req.nextUrl.searchParams.get("quantity") ?? 0);
    const readiness = await getLotMaterialReadiness(session.user.companyId, id, {
      newLotPieces: Number.isFinite(quantity) && quantity > 0 ? quantity : 0,
    });

    return NextResponse.json({ data: readiness });
  } catch (error) {
    return handleApiError(error);
  }
}
