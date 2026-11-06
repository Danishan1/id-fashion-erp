import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getSalesMarketingOverview } from "@/modules/sales-marketing/sales-marketing-overview.service";

/** GET /api/v1/sales-marketing/overview — the Sales & Marketing dashboard's data. */
export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sales_marketing", "view");
    const data = await getSalesMarketingOverview({ companyId: session.user.companyId, userId: session.user.id });
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
