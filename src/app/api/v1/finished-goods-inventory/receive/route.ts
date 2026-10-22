import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listPendingReceiptLines, receiveFinishedGoods } from "@/modules/finished-goods-inventory/finished-goods-receive.service";
import { receiveFinishedGoodsSchema } from "@/modules/finished-goods-inventory/finished-goods-receive.schema";

/** Goods from Packing or customer returns still waiting to be received into Finished Goods stock. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "fg_inventory", "view");
    const warehouseId = req.nextUrl.searchParams.get("warehouseId") || undefined;
    const data = await listPendingReceiptLines({ companyId: session.user.companyId }, { warehouseId });
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Receive pending lines into a location — this is what adds them to Finished Goods stock. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "fg_inventory", "edit");
    const input = receiveFinishedGoodsSchema.parse(await req.json());
    const data = await receiveFinishedGoods({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
