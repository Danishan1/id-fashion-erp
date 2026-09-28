import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getCrmDashboard } from "@/modules/crm/crm-dashboard.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "view");

    // Plain YYYY-MM-DD strings, passed through unchanged — createdRangeWhere()
    // (lead-segments.ts) turns them into an inclusive local-day range, the
    // exact same conversion the Leads list's createdFrom/createdTo uses, so
    // a dashboard card and its click-through list always agree.
    const dashboard = await getCrmDashboard(session.user.companyId, {
      dateFrom: req.nextUrl.searchParams.get("dateFrom") ?? undefined,
      dateTo: req.nextUrl.searchParams.get("dateTo") ?? undefined,
    });

    return NextResponse.json({ data: dashboard });
  } catch (error) {
    return handleApiError(error);
  }
}
