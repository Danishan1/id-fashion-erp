import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getDispatchableStock } from "@/modules/dispatch/dispatch.service";

/** ?warehouseId=&productIds=a,b[&excludeDispatchId=] → per-style dispatchable FG stock. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "dispatch", "view");

    const warehouseId = req.nextUrl.searchParams.get("warehouseId") ?? "";
    const productIds = (req.nextUrl.searchParams.get("productIds") ?? "").split(",").filter(Boolean).slice(0, 100);
    const excludeDispatchId = req.nextUrl.searchParams.get("excludeDispatchId") || undefined;
    if (!warehouseId || productIds.length === 0) return NextResponse.json({ data: {} });

    const stock = await getDispatchableStock(session.user.companyId, warehouseId, productIds, excludeDispatchId);
    return NextResponse.json({ data: Object.fromEntries(stock) });
  } catch (error) {
    return handleApiError(error);
  }
}
