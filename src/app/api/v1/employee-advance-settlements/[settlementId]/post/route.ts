import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { postEmployeeAdvanceSettlement } from "@/modules/accounts/employee-advance.service";

interface RouteContext {
  params: Promise<{ settlementId: string }>;
}

// No coarse PermissionService.assert here — postEmployeeAdvanceSettlement()
// itself asserts "expenses"/"approve" with the real self-approval-guarded
// resourceContext.
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    const { settlementId } = await params;
    const settlement = await postEmployeeAdvanceSettlement(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      settlementId
    );

    return NextResponse.json({ data: settlement });
  } catch (error) {
    return handleApiError(error);
  }
}
