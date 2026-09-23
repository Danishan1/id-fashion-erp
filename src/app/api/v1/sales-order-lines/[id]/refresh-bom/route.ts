import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { refreshSalesOrderLineBomSnapshot } from "@/modules/sales-orders/sales-order-bom-override.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * The explicit "Revise / Refresh BOM" action — the ONLY way a confirmed
 * Sales Order Line's own frozen snapshot moves onto a newer approved
 * BomVersion/SampleVersion. Never triggered by an ordinary order edit — see
 * refreshSalesOrderLineBomSnapshot's own doc comment.
 */
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sales_orders", "edit");

    const { id } = await params;
    const line = await refreshSalesOrderLineBomSnapshot({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: line });
  } catch (error) {
    return handleApiError(error);
  }
}
