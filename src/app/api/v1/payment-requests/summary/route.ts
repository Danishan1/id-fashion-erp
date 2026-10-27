import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getPaymentRequestSummary } from "@/modules/accounts/payment-requests/payment-request.service";

/** Counts per group and status for the hub's tabs (only requests the viewer can see). */
export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "payment_requests", "view");

    const data = await getPaymentRequestSummary({ companyId: session.user.companyId, userId: session.user.id });
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
