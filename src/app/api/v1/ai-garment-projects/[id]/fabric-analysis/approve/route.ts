import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { approveFabricAnalysis } from "@/modules/ai-garment-flow/fabric-analysis.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    // Matches reference-analysis's own approve route precedent — gated on
    // "edit", not a separate "approve" action.
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const analysis = await approveFabricAnalysis({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: analysis });
  } catch (error) {
    return handleApiError(error);
  }
}
