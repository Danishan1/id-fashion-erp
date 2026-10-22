import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listStagingBalances } from "@/modules/finished-goods-inventory/finished-goods-putaway.service";

/** Finished Goods received but not yet put away to a location (warehouse location = none). */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "fg_inventory", "view");
    const warehouseId = req.nextUrl.searchParams.get("warehouseId") || undefined;
    const data = await listStagingBalances({ companyId: session.user.companyId }, { warehouseId });
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
