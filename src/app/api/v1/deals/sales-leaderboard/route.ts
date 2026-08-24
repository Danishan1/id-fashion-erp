import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getSalesLeaderboard } from "@/modules/crm/deal.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "view");

    const leaderboard = await getSalesLeaderboard(session.user.companyId);

    return NextResponse.json({ data: leaderboard });
  } catch (error) {
    return handleApiError(error);
  }
}
