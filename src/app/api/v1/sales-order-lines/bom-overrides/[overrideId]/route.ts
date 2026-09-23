import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { deactivateSalesOrderBomOverride } from "@/modules/sales-orders/sales-order-bom-override.service";

interface RouteContext {
  params: Promise<{ overrideId: string }>;
}

/** Soft-retires one override — a real DB delete never happens, see
 * deactivateSalesOrderBomOverride's own doc comment. */
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sales_orders", "edit");

    const { overrideId } = await params;
    const override = await deactivateSalesOrderBomOverride({ companyId: session.user.companyId, userId: session.user.id }, overrideId);

    return NextResponse.json({ data: override });
  } catch (error) {
    return handleApiError(error);
  }
}
