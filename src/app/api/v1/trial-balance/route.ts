import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getTrialBalance } from "@/modules/accounts/journal.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "financial_reports", "view");

    const asOfDate = req.nextUrl.searchParams.get("asOfDate") || undefined;
    const data = await getTrialBalance(session.user.companyId, asOfDate);

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
