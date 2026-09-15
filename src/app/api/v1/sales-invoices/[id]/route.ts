import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { salesInvoiceSchema } from "@/modules/accounts/sales-invoice.schema";
import { getSalesInvoiceById, updateSalesInvoice } from "@/modules/accounts/sales-invoice.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "view");

    const { id } = await params;
    const invoice = await getSalesInvoiceById({ companyId: session.user.companyId, userId: session.user.id }, id);

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
    const input = salesInvoiceSchema.parse(await req.json());
    const invoice = await updateSalesInvoice({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: invoice });
  } catch (error) {
    return handleApiError(error);
  }
}
