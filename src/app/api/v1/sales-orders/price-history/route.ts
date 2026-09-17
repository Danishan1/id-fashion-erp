import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getSalesOrderPriceHistory } from "@/modules/sales-orders/sales-order.service";

const querySchema = z.object({
  customerId: z.string().uuid(),
  productId: z.string().uuid(),
  excludeOrderId: z.string().uuid().optional(),
});

/**
 * The fuller sibling of last-price/route.ts — every real price this exact
 * customer was actually charged for this exact style (not just the most
 * recent one), so the Unit Price field can offer real negotiated history as
 * datalist suggestions. `excludeOrderId` (the order currently being edited)
 * keeps an in-progress edit from suggesting its own not-yet-saved price back
 * to itself. `sinceDays` scopes the window (the create form asks for the
 * last year); omitted returns the full history.
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
    const sinceDaysParam = req.nextUrl.searchParams.get("sinceDays");
    const sinceDays = sinceDaysParam && /^\d+$/.test(sinceDaysParam) ? Number(sinceDaysParam) : null;
    const sinceDate = sinceDays ? new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000) : undefined;

    const history = await getSalesOrderPriceHistory(session.user.companyId, customerId, productId, excludeOrderId, sinceDate);

    return NextResponse.json({ data: history });
  } catch (error) {
    return handleApiError(error);
  }
}
