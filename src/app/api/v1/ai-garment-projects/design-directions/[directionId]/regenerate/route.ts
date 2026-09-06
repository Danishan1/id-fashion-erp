import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { regenerateDesignDirection } from "@/modules/ai-garment-flow/development-brief.service";

interface RouteContext {
  params: Promise<{ directionId: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { directionId } = await params;
    const direction = await regenerateDesignDirection(
      { companyId: session.user.companyId, userId: session.user.id },
      directionId
    );

    return NextResponse.json({ data: direction });
  } catch (error) {
    return handleApiError(error);
  }
}
