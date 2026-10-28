import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listExpenseAccountOptions } from "@/modules/finance-config/payee-purpose.service";

/** Expense accounts a purpose may default to — finance masters users don't necessarily hold accounts.view. */
export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_finance", "view");
    return NextResponse.json({ data: await listExpenseAccountOptions(session.user.companyId) });
  } catch (error) {
    return handleApiError(error);
  }
}
