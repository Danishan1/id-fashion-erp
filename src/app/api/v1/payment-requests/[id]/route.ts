import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updatePaymentRequestSchema } from "@/modules/accounts/payment-requests/payment-request.schema";
import { getPaymentRequestById, updatePaymentRequest } from "@/modules/accounts/payment-requests/payment-request.service";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "payment_requests", "view");

    const { id } = await params;
    const request = await getPaymentRequestById({ companyId: session.user.companyId, userId: session.user.id }, id);
    return NextResponse.json({ data: request });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // Coarse gate: raisers hold "create"; updatePaymentRequest() also requires
    // "edit" when the actor did not raise the request.
    await PermissionService.assertAny(session.user.id, [
      ["payment_requests", "create"],
      ["payment_requests", "edit"],
    ]);

    const { id } = await params;
    const input = updatePaymentRequestSchema.parse(await req.json());
    const request = await updatePaymentRequest(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );
    return NextResponse.json({ data: request });
  } catch (error) {
    return handleApiError(error);
  }
}
