import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { paymentAllocateSchema } from "@/modules/accounts/payment.schema";
import { allocatePayment } from "@/modules/accounts/payment.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // Coarse gate here; allocatePayment() re-asserts "approve" internally
    // with resourceContext.createdBy, which is what enforces self-approval.
    await PermissionService.assert(session.user.id, "payments", "approve");

    const { id } = await params;
    const input = paymentAllocateSchema.parse(await req.json());
    const payment = await allocatePayment(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: payment });
  } catch (error) {
    return handleApiError(error);
  }
}
