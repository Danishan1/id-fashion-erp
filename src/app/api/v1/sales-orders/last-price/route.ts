import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getLastOrderedPrice } from "@/modules/sales-orders/sales-order.service";

const querySchema = z.object({
  customerId: z.string().uuid(),
  productId: z.string().uuid(),
  excludeOrderId: z.string().uuid().optional(),
});

/**
 * Advisory "Last Order Price" lookup for the New/Edit Sales Order form's
 * Unit Price default — what this exact customer was actually charged the
 * last time they ordered this exact style. `excludeOrderId` (the order
 * currently being edited) keeps an in-progress edit from suggesting its own
 * not-yet-saved price back to itself. Returns `data: null` when there's no
 * prior order at all, never a 404 — this is a normal, common outcome for a
 * first-time line.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sales_orders", "view");

    const { customerId, productId, excludeOrderId } = querySchema.parse({
      customerId: req.nextUrl.searchParams.get("customerId"),
      productId: req.nextUrl.searchParams.get("productId"),
      excludeOrderId: req.nextUrl.searchParams.get("excludeOrderId") ?? undefined,
    });

    const lastPrice = await getLastOrderedPrice(session.user.companyId, customerId, productId, excludeOrderId);

    return NextResponse.json({ data: lastPrice });
  } catch (error) {
    return handleApiError(error);
  }
}
