import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getUsageDashboard } from "@/modules/ai-providers/ai-provider-admin.service";

/** Real, locally-tracked usage counts per provider — never a fabricated provider-side credit balance, see getUsageDashboard's own comment. */
export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration", "view");

    const usage = await getUsageDashboard(session.user.companyId);
    return NextResponse.json({ data: usage });
  } catch (error) {
    return handleApiError(error);
  }
}
