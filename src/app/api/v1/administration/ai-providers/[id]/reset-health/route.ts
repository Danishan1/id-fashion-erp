import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { resetProviderHealth } from "@/modules/ai-providers/ai-provider-admin.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Manual override once an admin has fixed a credential/outage — see resetProviderHealth's own comment. */
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration", "edit");

    const { id } = await params;
    const provider = await resetProviderHealth({ companyId: session.user.companyId, userId: session.user.id }, id);
    return NextResponse.json({ data: provider });
  } catch (error) {
    return handleApiError(error);
  }
}
