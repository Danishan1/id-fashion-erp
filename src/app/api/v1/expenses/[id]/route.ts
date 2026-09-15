import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { expenseSchema } from "@/modules/accounts/expense.schema";
import { getExpenseById, updateExpense } from "@/modules/accounts/expense.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "expenses", "view");

    const { id } = await params;
    const expense = await getExpenseById({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: expense });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "expenses", "edit");

    const { id } = await params;
    const input = expenseSchema.parse(await req.json());
    const expense = await updateExpense(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: expense });
  } catch (error) {
    return handleApiError(error);
  }
}
