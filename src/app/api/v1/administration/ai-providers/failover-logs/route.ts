import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getFailoverLogs } from "@/modules/ai-providers/ai-provider-admin.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration", "view");

    const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50));
    const logs = await getFailoverLogs(session.user.companyId, limit);
    return NextResponse.json({ data: logs });
  } catch (error) {
    return handleApiError(error);
  }
}
