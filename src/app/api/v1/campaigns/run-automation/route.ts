import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { runMarketingAutomation } from "@/modules/marketing/campaign.service";

export async function POST() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "marketing", "edit");

    const result = await runMarketingAutomation(session.user.companyId);

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
