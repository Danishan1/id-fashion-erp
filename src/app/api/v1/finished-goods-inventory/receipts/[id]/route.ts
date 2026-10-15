import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getFinishedGoodsReceiptById } from "@/modules/finished-goods-inventory/finished-goods-receipt-list.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "fg_inventory", "view");

    const { id } = await params;
    const data = await getFinishedGoodsReceiptById(session.user.companyId, id);

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
