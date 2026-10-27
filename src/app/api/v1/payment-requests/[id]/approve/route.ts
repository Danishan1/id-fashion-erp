import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { approvePaymentRequest } from "@/modules/accounts/payment-requests/payment-request.service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // Coarse gate; approvePaymentRequest() re-asserts with createdBy (self-approval guard).
    await PermissionService.assert(session.user.id, "payment_requests", "approve");

    const { id } = await params;
    const request = await approvePaymentRequest({ companyId: session.user.companyId, userId: session.user.id }, id);
    return NextResponse.json({ data: request });
  } catch (error) {
    return handleApiError(error);
  }
}
