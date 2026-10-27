import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { paymentRequestPayoutSchema } from "@/modules/accounts/payment-requests/payout.schema";
import { recordPaymentRequestPayout } from "@/modules/accounts/payment-requests/payout.service";

/** The accountant pays an approved request, fully or in part. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // Coarse gate; recordPaymentRequestPayout() re-asserts with createdBy and
    // applies the Approval Matrix "approver may pay" rule.
    await PermissionService.assert(session.user.id, "payment_requests", "post");

    const { id } = await params;
    const input = paymentRequestPayoutSchema.parse(await req.json());
    const request = await recordPaymentRequestPayout(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );
    return NextResponse.json({ data: request }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
