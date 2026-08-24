import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { expenseSchema } from "@/modules/accounts/expense.schema";
import { createExpense, listExpenses } from "@/modules/accounts/expense.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "expenses", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "expenseDate");
    const { data, totalCount } = await listExpenses(session.user.companyId, query);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "expenses", "create");

    const input = expenseSchema.parse(await req.json());
    const expense = await createExpense(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: expense }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
