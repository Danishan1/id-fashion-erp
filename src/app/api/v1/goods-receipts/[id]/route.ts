import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getGoodsReceiptById } from "@/modules/purchasing/goods-receipt.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "view");

    const { id } = await params;
    const receipt = await getGoodsReceiptById({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: receipt });
  } catch (error) {
    return handleApiError(error);
  }
}
