import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { approveTechPack } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string; techPackId: string }>;
}

/** Approves the current Tech Pack revision — self-approval-guarded internally via approveTechPack(). */
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "approve");

    const { id, techPackId } = await params;
    const result = await approveTechPack({ companyId: session.user.companyId, userId: session.user.id }, id, techPackId);

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
