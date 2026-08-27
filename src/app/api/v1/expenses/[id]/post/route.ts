import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { postExpense } from "@/modules/accounts/expense.service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // Coarse gate here; postExpense() re-asserts "post" internally with
    // resourceContext.createdBy, which is what enforces self-approval — this
    // is a DISTINCT checkpoint from the Admin's "approve" above (a creator
    // can't approve their own expense, and separately can't pay it either).
    await PermissionService.assert(session.user.id, "expenses", "post");

    const { id } = await params;
    const expense = await postExpense(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id
    );

    return NextResponse.json({ data: expense });
  } catch (error) {
    return handleApiError(error);
  }
}
