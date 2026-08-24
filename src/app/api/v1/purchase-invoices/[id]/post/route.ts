import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { postPurchaseInvoice } from "@/modules/accounts/purchase-invoice.service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // Coarse gate here; postPurchaseInvoice() re-asserts "post" internally
    // with resourceContext.createdBy, which is what enforces self-approval.
    await PermissionService.assert(session.user.id, "invoices", "post");

    const { id } = await params;
    const invoice = await postPurchaseInvoice(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id
    );

    return NextResponse.json({ data: invoice });
  } catch (error) {
    return handleApiError(error);
  }
}
