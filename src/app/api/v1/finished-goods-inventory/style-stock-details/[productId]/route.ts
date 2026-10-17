import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getStyleStockSummary } from "@/modules/finished-goods-inventory/finished-goods-style-stock-details.service";

interface RouteContext {
  params: Promise<{ productId: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "fg_inventory", "view");

    const { productId } = await params;
    const data = await getStyleStockSummary(session.user.companyId, productId);

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
