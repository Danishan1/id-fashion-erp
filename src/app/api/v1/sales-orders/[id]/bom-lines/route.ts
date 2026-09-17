import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getSalesOrderRawBomLines } from "@/modules/bom-mrp/mrp.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * The color/shade-preserving sibling of material-preview's aggregated
 * figures — one row per real BOM/Sample material line, never merged across
 * colors — powering the Material Request create form's "Add from this
 * Order's BOM" picker, where each addable line needs its own editable
 * color/shade, not a company-wide total. Gated on sales_orders:view for the
 * exact same reason material-preview is (Material Request creation already
 * requires listing Sales Orders via that permission).
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sales_orders", "view");

    const { id } = await params;
    const preview = await getSalesOrderRawBomLines(session.user.companyId, id);

    return NextResponse.json({ data: preview });
  } catch (error) {
    return handleApiError(error);
  }
}
