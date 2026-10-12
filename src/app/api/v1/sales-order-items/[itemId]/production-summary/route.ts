import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getSalesOrderItemProductionSummary } from "@/modules/production/production-progress.service";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Gated on sales_orders.view (not production.view) — this is surfaced on
 * the Sales Order detail page itself, read-only informational context for
 * anyone who can already see that order, distinct from
 * production-orders/sales-order-commitment (production.view), which backs
 * the Production Order creation flow instead. Also reused by the Dispatch
 * create/edit form (Phase B, 2026-10-10) — same permission the form already
 * requires to fetch the Sales Order itself, so this introduces no new
 * access beyond what Dispatch creation already needed.
 *
 * Optional ?warehouseId= — when the caller already knows which warehouse a
 * dispatch will draw from (Dispatch does, Sales Order's own detail page
 * doesn't), also returns real available stock for this line's product at
 * that warehouse. Validated as well-formed here only — getAvailableQuantity()
 * is already company-scoped via StockBalance's own composite key, so a
 * cross-tenant warehouseId simply resolves to 0, the same trust model every
 * other existing caller of that function already relies on.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sales_orders", "view");

    const { itemId } = await params;
    const warehouseIdParam = req.nextUrl.searchParams.get("warehouseId");
    const warehouseId = warehouseIdParam && UUID_RE.test(warehouseIdParam) ? warehouseIdParam : undefined;
    const data = await getSalesOrderItemProductionSummary(session.user.companyId, itemId, warehouseId);

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
