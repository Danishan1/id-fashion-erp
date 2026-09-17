import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getOtherWarehouseStockForLine } from "@/modules/inventory/material-request.service";

interface RouteContext {
  params: Promise<{ lineId: string }>;
}

// Where this line's material actually has real stock, at every warehouse
// other than the request's own — purely informational (view, not edit),
// surfaced when a line's own "Available Stock" reads 0 so a merchandiser
// can see whether the material simply doesn't exist yet or is sitting
// somewhere else entirely.
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "view");

    const { lineId } = await params;
    const warehouses = await getOtherWarehouseStockForLine({ companyId: session.user.companyId, userId: session.user.id }, lineId);

    return NextResponse.json({ data: warehouses });
  } catch (error) {
    return handleApiError(error);
  }
}
