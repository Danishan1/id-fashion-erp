import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getSalesOrderItemProductionSummary } from "@/modules/production/production-progress.service";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

/**
 * Gated on sales_orders.view (not production.view) — this is surfaced on
 * the Sales Order detail page itself, read-only informational context for
 * anyone who can already see that order, distinct from
 * production-orders/sales-order-commitment (production.view), which backs
 * the Production Order creation flow instead.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sales_orders", "view");

    const { itemId } = await params;
    const data = await getSalesOrderItemProductionSummary(session.user.companyId, itemId);

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
