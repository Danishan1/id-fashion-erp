import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { runFabricAnalysis } from "@/modules/ai-garment-flow/fabric-analysis.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const analysis = await runFabricAnalysis({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: analysis }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
