import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { postPayment } from "@/modules/accounts/payment.service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // Coarse gate here; postPayment() re-asserts "approve" internally with
    // resourceContext.createdBy, which is what enforces self-approval.
    await PermissionService.assert(session.user.id, "payments", "approve");

    const { id } = await params;
    const payment = await postPayment(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id
    );

    return NextResponse.json({ data: payment });
  } catch (error) {
    return handleApiError(error);
  }
}
