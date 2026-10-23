import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { expensePaymentSchema } from "@/modules/accounts/expense.schema";
import { recordExpensePayment } from "@/modules/accounts/expense.service";

/** Records one payment (full or part) against an approved expense. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // Coarse gate; recordExpensePayment re-asserts "post" with the creator
    // self-guard (a creator can't pay their own expense).
    await PermissionService.assert(session.user.id, "expenses", "post");

    const { id } = await params;
    const input = expensePaymentSchema.parse(await req.json());
    const expense = await recordExpensePayment(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: expense }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
