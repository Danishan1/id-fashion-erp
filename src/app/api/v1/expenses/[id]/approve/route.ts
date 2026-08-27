import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { approveExpense } from "@/modules/accounts/expense.service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // Coarse gate here; approveExpense() re-asserts "approve" internally with
    // resourceContext.createdBy, which is what enforces self-approval.
    await PermissionService.assert(session.user.id, "expenses", "approve");

    const { id } = await params;
    const expense = await approveExpense(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id
    );

    return NextResponse.json({ data: expense });
  } catch (error) {
    return handleApiError(error);
  }
}
