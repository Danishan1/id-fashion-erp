import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { approveDecisionSchema } from "@/modules/accounts/payment-requests/approval-matrix.schema";
import { approvePaymentRequest } from "@/modules/accounts/payment-requests/payment-request.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // Coarse gate; approvePaymentRequest() re-asserts with createdBy (self-approval
    // guard) and checks the actor is an approver of the current level.
    await PermissionService.assert(session.user.id, "payment_requests", "approve");

    const { id } = await params;
    const { remark } = approveDecisionSchema.parse(await req.json().catch(() => ({})));
    const request = await approvePaymentRequest({ companyId: session.user.companyId, userId: session.user.id }, id, remark);
    return NextResponse.json({ data: request });
  } catch (error) {
    return handleApiError(error);
  }
}
