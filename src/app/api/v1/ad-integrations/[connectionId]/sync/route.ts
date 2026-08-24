import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { syncConnectionSchema } from "@/modules/marketing/ad-integrations/ad-integration.schema";
import { syncAdAccountConnection } from "@/modules/marketing/ad-integrations/ad-integration.service";

interface RouteContext {
  params: Promise<{ connectionId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "marketing", "edit");

    const { connectionId } = await params;
    const body = await req.json().catch(() => ({}));
    const input = syncConnectionSchema.parse(body);

    const result = await syncAdAccountConnection(
      { companyId: session.user.companyId, userId: session.user.id },
      connectionId,
      input.daysBack
    );

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
