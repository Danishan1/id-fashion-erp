import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getAdIntegrationConfigStatus } from "@/modules/marketing/ad-integrations/ad-integration.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "marketing", "view");

    return NextResponse.json({ data: getAdIntegrationConfigStatus() });
  } catch (error) {
    return handleApiError(error);
  }
}
