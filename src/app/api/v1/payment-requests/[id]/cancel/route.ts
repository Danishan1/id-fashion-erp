import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { cancelPaymentRequest } from "@/modules/accounts/payment-requests/payment-request.service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // Raisers cancel their own with "create"; cancelPaymentRequest() needs
    // "cancel" for anyone else's request.
    await PermissionService.assertAny(session.user.id, [
      ["payment_requests", "create"],
      ["payment_requests", "cancel"],
    ]);

    const { id } = await params;
    const request = await cancelPaymentRequest({ companyId: session.user.companyId, userId: session.user.id }, id);
    return NextResponse.json({ data: request });
  } catch (error) {
    return handleApiError(error);
  }
}
