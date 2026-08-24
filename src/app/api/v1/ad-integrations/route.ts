import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listAdAccountConnections } from "@/modules/marketing/ad-integrations/ad-integration.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "marketing", "view");

    const connections = await listAdAccountConnections(session.user.companyId);
    return NextResponse.json({ data: connections });
  } catch (error) {
    return handleApiError(error);
  }
}
