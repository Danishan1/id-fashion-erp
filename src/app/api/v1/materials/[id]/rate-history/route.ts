import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getMaterialRateHistory } from "@/modules/purchasing/goods-receipt.service";

/**
 * Gated on sampling.edit — the only current caller is the Sample Material
 * Rate modal, which needs this to suggest a real historical rate instead of
 * a blank field. Revisit the permission if a second module needs this same
 * lookup later.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "edit");

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const colorId = searchParams.get("colorId") || null;
    const dyeId = searchParams.get("dyeId") || null;

    const result = await getMaterialRateHistory(session.user.companyId, id, colorId, dyeId);
    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
