import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { approveSketchAnalysis } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const analysis = await approveSketchAnalysis({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: analysis });
  } catch (error) {
    return handleApiError(error);
  }
}
