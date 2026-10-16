import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listDispatchEligibleSalesOrders } from "@/modules/production/dispatch-readiness.service";

/**
 * Sales Orders with at least one line that has genuinely dispatchable
 * (Packing-complete, not-yet-shipped) quantity remaining — the New Dispatch
 * form's own Sales Order picker uses this instead of the generic sales-orders
 * list, so a merchandiser can't even select an order with nothing real to
 * dispatch (2026-10-16, process-flow clarity spec §3).
 */
export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "dispatch", "view");
    const data = await listDispatchEligibleSalesOrders({ companyId: session.user.companyId, userId: session.user.id });
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
