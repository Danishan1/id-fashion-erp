import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { listOutstandingInvoicesForParty } from "@/modules/accounts/payment.service";

// Feeds the create-payment form's allocation picker — a Customer's
// outstanding Sales Invoices (RECEIPT) or a Supplier's outstanding Purchase
// Invoices (PAYMENT_OUT). Gated on "payments" view, not "invoices" view,
// since this is read purely in service of building a Payment.
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "payments", "view");

    const direction = req.nextUrl.searchParams.get("direction");
    const partyId = req.nextUrl.searchParams.get("partyId");
    if ((direction !== "RECEIPT" && direction !== "PAYMENT_OUT") || !partyId) {
      throw new BusinessRuleError("VALIDATION_ERROR", "direction (RECEIPT|PAYMENT_OUT) and partyId are required.", {});
    }

    const data = await listOutstandingInvoicesForParty(session.user.companyId, direction, partyId);

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
