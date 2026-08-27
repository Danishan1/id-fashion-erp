import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { previewNextInvoiceNumber } from "@/modules/accounts/invoice-series.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "view");

    const seriesId = req.nextUrl.searchParams.get("seriesId");
    if (!seriesId) throw new BusinessRuleError("VALIDATION_ERROR", "seriesId is required.");

    const preview = await previewNextInvoiceNumber(session.user.companyId, seriesId);
    return NextResponse.json({ data: preview });
  } catch (error) {
    return handleApiError(error);
  }
}
