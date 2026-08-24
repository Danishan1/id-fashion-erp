import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getChannelPerformance } from "@/modules/marketing/campaign.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "marketing", "view");

    const params = req.nextUrl.searchParams;
    const dateFrom = params.get("dateFrom");
    const dateTo = params.get("dateTo");

    const rows = await getChannelPerformance(session.user.companyId, {
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      // Inclusive end-of-day, per this project's own established fix for
      // "dateTo" filters against full-timestamp columns (see the CRM
      // dashboard's identical fix) — a plain date-only Date() parse would
      // silently exclude everything created later that same day.
      dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999`) : undefined,
      channel: params.get("channel") ?? undefined,
      campaignId: params.get("campaignId") ?? undefined,
    });

    return NextResponse.json({ data: rows });
  } catch (error) {
    return handleApiError(error);
  }
}
