import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getReferenceAnalysis } from "@/modules/ai-garment-flow/reference-analysis.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "view");

    const { id } = await params;
    const analysis = await getReferenceAnalysis(session.user.companyId, id);

    return NextResponse.json({ data: analysis });
  } catch (error) {
    return handleApiError(error);
  }
}
