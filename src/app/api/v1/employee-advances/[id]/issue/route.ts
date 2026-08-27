import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { issueEmployeeAdvance } from "@/modules/accounts/employee-advance.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// No coarse PermissionService.assert here — issueEmployeeAdvance() itself
// asserts "expenses"/"approve" with the real self-approval-guarded
// resourceContext, matching Expense's own postExpense route.
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const advance = await issueEmployeeAdvance(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id
    );

    return NextResponse.json({ data: advance });
  } catch (error) {
    return handleApiError(error);
  }
}
