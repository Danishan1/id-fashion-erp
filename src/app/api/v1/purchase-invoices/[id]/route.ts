import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { purchaseInvoiceSchema } from "@/modules/accounts/purchase-invoice.schema";
import { getPurchaseInvoiceById, updatePurchaseInvoice } from "@/modules/accounts/purchase-invoice.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "view");

    const { id } = await params;
    const invoice = await getPurchaseInvoiceById(session.user.companyId, id);

    return NextResponse.json({ data: invoice });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "edit");

    const { id } = await params;
    const input = purchaseInvoiceSchema.parse(await req.json());
    const invoice = await updatePurchaseInvoice({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: invoice });
  } catch (error) {
    return handleApiError(error);
  }
}
