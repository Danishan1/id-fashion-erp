import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { reverseGoodsReceiptLineSchema } from "@/modules/purchasing/goods-receipt.schema";
import { reverseGoodsReceiptLine } from "@/modules/purchasing/goods-receipt.service";

interface RouteContext {
  params: Promise<{ id: string; itemId: string }>;
}

// The `id` (goods receipt) segment is not used directly here — the item id
// alone is enough to resolve and company-scope the line — but it's kept in
// the route shape since a reversal is always framed as "reverse a line on
// this receipt" from the UI, matching the resource hierarchy.
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "edit");

    const { itemId } = await params;
    const input = reverseGoodsReceiptLineSchema.parse(await req.json());
    const receipt = await reverseGoodsReceiptLine(
      { companyId: session.user.companyId, userId: session.user.id },
      itemId,
      input
    );

    return NextResponse.json({ data: receipt });
  } catch (error) {
    return handleApiError(error);
  }
}
