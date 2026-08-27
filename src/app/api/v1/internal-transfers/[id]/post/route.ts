import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { postInternalTransfer } from "@/modules/accounts/internal-transfer.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// No coarse PermissionService.assert here — postInternalTransfer() itself
// asserts "accounts"/"post" with the real self-approval-guarded
// resourceContext, matching every other post/approve route in this module.
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const transfer = await postInternalTransfer(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id
    );

    return NextResponse.json({ data: transfer });
  } catch (error) {
    return handleApiError(error);
  }
}
