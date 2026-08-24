import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { cancelPayment } from "@/modules/accounts/payment.service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "payments", "cancel");

    const { id } = await params;
    const payment = await cancelPayment({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: payment });
  } catch (error) {
    return handleApiError(error);
  }
}
