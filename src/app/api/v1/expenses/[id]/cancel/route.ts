import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { cancelExpense } from "@/modules/accounts/expense.service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "expenses", "cancel");

    const { id } = await params;
    const expense = await cancelExpense({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: expense });
  } catch (error) {
    return handleApiError(error);
  }
}
