import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getRawMaterialStockDetail } from "@/modules/inventory/raw-material-stock.service";

/** One raw material's stock: by roll, by colour, or plain, plus warehouse-wise. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "view");

    const { productId } = await params;
    const warehouseId = req.nextUrl.searchParams.get("warehouseId") || undefined;
    const data = await getRawMaterialStockDetail(session.user.companyId, productId, { warehouseId });

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
