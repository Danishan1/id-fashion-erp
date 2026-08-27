import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateCustomInvoiceSchema } from "@/modules/accounts/custom-invoice.schema";
import { getCustomInvoiceById, updateCustomInvoice } from "@/modules/accounts/custom-invoice.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "view");

    const { id } = await params;
    const invoice = await getCustomInvoiceById(session.user.companyId, id);

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
    const input = updateCustomInvoiceSchema.parse(await req.json());
    const invoice = await updateCustomInvoice(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: invoice });
  } catch (error) {
    return handleApiError(error);
  }
}
