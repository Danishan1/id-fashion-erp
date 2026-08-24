import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { cancelSalesInvoice } from "@/modules/accounts/sales-invoice.service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "cancel");

    const { id } = await params;
    const invoice = await cancelSalesInvoice({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: invoice });
  } catch (error) {
    return handleApiError(error);
  }
}
