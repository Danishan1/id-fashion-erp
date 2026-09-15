import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getSalesOrderMaterialPreview } from "@/modules/bom-mrp/mrp.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Per-style-line BOM/Sample material breakdown for one Sales Order — reused
 * by both the order's own detail page ("Estimated Material Cost") and the
 * Material Request create form's "add items from this order's BOM" preview.
 * Gated on sales_orders:view (not bom_mrp:view) since Material Request
 * creation already requires listing Sales Orders via that same permission
 * (see /api/v1/sales-orders' own GET route) — this is informational display,
 * never a stock reservation or a write.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sales_orders", "view");

    const { id } = await params;
    const preview = await getSalesOrderMaterialPreview(session.user.companyId, id);

    return NextResponse.json({ data: preview });
  } catch (error) {
    return handleApiError(error);
  }
}
