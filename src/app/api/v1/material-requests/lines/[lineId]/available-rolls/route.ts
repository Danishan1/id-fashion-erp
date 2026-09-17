import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getAvailableRollsForLine } from "@/modules/inventory/material-request.service";

interface RouteContext {
  params: Promise<{ lineId: string }>;
}

// The color/shade/GSM/composition-wise stock breakdown for this line's
// material at its request's warehouse — feeds the Issue modal's roll picker.
// Same "edit" gate as the Issue action itself, since this is only ever
// fetched right before issuing. An optional `?warehouseId=` re-scopes this
// to an alternate warehouse — the Issue modal's own "Change Warehouse"
// picker (2026-09-16) re-calls this once a different warehouse is chosen.
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "edit");

    const { lineId } = await params;
    const warehouseId = req.nextUrl.searchParams.get("warehouseId") ?? undefined;
    const rolls = await getAvailableRollsForLine({ companyId: session.user.companyId, userId: session.user.id }, lineId, warehouseId);

    return NextResponse.json({ data: rolls });
  } catch (error) {
    return handleApiError(error);
  }
}
