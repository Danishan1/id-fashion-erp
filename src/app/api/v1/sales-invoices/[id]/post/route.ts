import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { postSalesInvoice } from "@/modules/accounts/sales-invoice.service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // Coarse gate here; postSalesInvoice() re-asserts "post" internally with
    // resourceContext.createdBy once it knows who created the invoice, which
    // is what actually enforces the self-approval guard.
    await PermissionService.assert(session.user.id, "invoices", "post");

    const { id } = await params;
    const invoice = await postSalesInvoice(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id
    );

    return NextResponse.json({ data: invoice });
  } catch (error) {
    return handleApiError(error);
  }
}
