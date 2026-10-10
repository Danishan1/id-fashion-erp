import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { disconnectAdAccountConnection } from "@/modules/marketing/ad-integrations/ad-integration.service";

interface RouteContext {
  params: Promise<{ connectionId: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "marketing", "edit");

    const { connectionId } = await params;
    const connection = await disconnectAdAccountConnection({ companyId: session.user.companyId, userId: session.user.id }, connectionId);

    return NextResponse.json({ data: connection });
  } catch (error) {
    return handleApiError(error);
  }
}
