import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { customInvoicePaymentSchema } from "@/modules/accounts/custom-invoice-payment.schema";
import { recordCustomInvoicePayment } from "@/modules/accounts/custom-invoice-payment.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "create");

    const { id } = await params;
    const input = customInvoicePaymentSchema.parse(await req.json());
    const payment = await recordCustomInvoicePayment({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: payment }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
