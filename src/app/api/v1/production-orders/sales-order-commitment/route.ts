import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getSalesOrderLineCommitment } from "@/modules/production/production-order.service";

/**
 * Purely informational, pre-creation preview of a Sales Order line's ordered
 * quantity vs. what's already committed to other Production Orders — never
 * a cap, see getSalesOrderLineCommitment's own doc comment. Backs the New
 * Production Order form's default-fill and reference display.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view");

    const salesOrderItemId = req.nextUrl.searchParams.get("salesOrderItemId");
    if (!salesOrderItemId) throw new BusinessRuleError("VALIDATION_ERROR", "salesOrderItemId is required.");

    const data = await getSalesOrderLineCommitment(session.user.companyId, salesOrderItemId);

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
