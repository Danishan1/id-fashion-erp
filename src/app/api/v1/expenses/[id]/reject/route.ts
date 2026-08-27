import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { rejectExpenseSchema } from "@/modules/accounts/expense.schema";
import { rejectExpense } from "@/modules/accounts/expense.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "expenses", "reject");

    const { id } = await params;
    const { rejectionReason } = rejectExpenseSchema.parse(await req.json());
    const expense = await rejectExpense(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      rejectionReason
    );

    return NextResponse.json({ data: expense });
  } catch (error) {
    return handleApiError(error);
  }
}
