import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { cancelGoodsReceiptSchema } from "@/modules/purchasing/goods-receipt.schema";
import { cancelGoodsReceipt } from "@/modules/purchasing/goods-receipt.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "edit");

    const { id } = await params;
    const { reason } = cancelGoodsReceiptSchema.parse(await req.json());
    const receipt = await cancelGoodsReceipt({ companyId: session.user.companyId, userId: session.user.id }, id, reason);

    return NextResponse.json({ data: receipt });
  } catch (error) {
    return handleApiError(error);
  }
}
