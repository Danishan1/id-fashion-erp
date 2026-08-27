import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getCustomInvoiceClientLedger } from "@/modules/accounts/custom-invoice-ledger.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "view");

    const customerId = req.nextUrl.searchParams.get("customerId");
    if (!customerId) throw new BusinessRuleError("VALIDATION_ERROR", "customerId is required.");

    const ledger = await getCustomInvoiceClientLedger(session.user.companyId, customerId);
    return NextResponse.json({ data: ledger });
  } catch (error) {
    return handleApiError(error);
  }
}
