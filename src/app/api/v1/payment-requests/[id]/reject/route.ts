import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { rejectPaymentRequestSchema } from "@/modules/accounts/payment-requests/payment-request.schema";
import { rejectPaymentRequest } from "@/modules/accounts/payment-requests/payment-request.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "payment_requests", "reject");

    const { id } = await params;
    const { rejectionReason } = rejectPaymentRequestSchema.parse(await req.json());
    const request = await rejectPaymentRequest(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      rejectionReason
    );
    return NextResponse.json({ data: request });
  } catch (error) {
    return handleApiError(error);
  }
}
