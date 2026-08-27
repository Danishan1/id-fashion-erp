import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { cancelCustomInvoicePayment } from "@/modules/accounts/custom-invoice-payment.service";

interface RouteContext {
  params: Promise<{ paymentId: string }>;
}

export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "cancel");

    const { paymentId } = await params;
    const payment = await cancelCustomInvoicePayment({ companyId: session.user.companyId, userId: session.user.id }, paymentId);

    return NextResponse.json({ data: payment });
  } catch (error) {
    return handleApiError(error);
  }
}
