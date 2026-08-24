import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getCrmDashboard } from "@/modules/crm/crm-dashboard.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "view");

    const dateFrom = req.nextUrl.searchParams.get("dateFrom");
    const dateTo = req.nextUrl.searchParams.get("dateTo");

    const dashboard = await getCrmDashboard(session.user.companyId, {
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      // Leads/Deals carry a full timestamp (createdAt), not a plain date
      // column — `new Date("2026-08-24")` parses as that day's UTC midnight,
      // which combined with a `lte` comparison would silently exclude every
      // record created later the same day (i.e. every "today" preset would
      // exclude today's own activity). Push to the end of that calendar day
      // so a "dateTo" the user picked is genuinely inclusive.
      dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999`) : undefined,
    });

    return NextResponse.json({ data: dashboard });
  } catch (error) {
    return handleApiError(error);
  }
}
