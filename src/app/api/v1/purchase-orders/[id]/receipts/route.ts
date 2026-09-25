import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { goodsReceiptSchema } from "@/modules/purchasing/goods-receipt.schema";
import { createGoodsReceipt } from "@/modules/purchasing/goods-receipt.service";
import { getPurchaseOrderById } from "@/modules/purchasing/purchase-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "purchase_order", "view");

    const { id } = await params;
    const order = await getPurchaseOrderById({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: order.receipts });
  } catch (error) {
    return handleApiError(error);
  }
}

// Gated on "inventory" (create), not "purchase_order" — Goods Receipt stays
// part of the inventory module by design (RBAC audit, 2026-09-24 — not
// split out further), and the persona who physically receives goods at the
// dock (WAREHOUSE_USER/STORE_MANAGER) is granted inventory:create/edit but
// not purchase_order:edit/approve in the seeded RBAC matrix; gating this on
// purchase_order would lock them out.
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "create");

    const { id } = await params;
    const input = goodsReceiptSchema.parse(await req.json());
    const receipt = await createGoodsReceipt(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: receipt }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
