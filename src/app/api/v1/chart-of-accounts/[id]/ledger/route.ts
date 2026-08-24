import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getAccountLedger } from "@/modules/accounts/chart-of-account.service";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "view");

    const { id } = await params;
    const dateFrom = req.nextUrl.searchParams.get("dateFrom") || undefined;
    const dateTo = req.nextUrl.searchParams.get("dateTo") || undefined;
    const ledger = await getAccountLedger(session.user.companyId, id, dateFrom, dateTo);

    return NextResponse.json({ data: ledger });
  } catch (error) {
    return handleApiError(error);
  }
}
