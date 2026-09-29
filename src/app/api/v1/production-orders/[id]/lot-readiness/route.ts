import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
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
    await PermissionService.assert(session.user.id, "production", "view");

    const { id } = await params;
    const quantity = Number(req.nextUrl.searchParams.get("quantity") ?? 0);
    const readiness = await getLotMaterialReadiness(session.user.companyId, id, {
      newLotPieces: Number.isFinite(quantity) && quantity > 0 ? quantity : 0,
    });

    return NextResponse.json({ data: readiness });
  } catch (error) {
    return handleApiError(error);
  }
}
