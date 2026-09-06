import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { approveReferenceAnalysis } from "@/modules/ai-garment-flow/reference-analysis.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    // Matches convertSampleToStyle()/convertProjectToStyle()'s own precedent
    // — gated on "edit", not a separate "approve" action (no role needs a
    // distinct maker/checker split for this one yet; the merchandiser who
    // reviews the corrections is also who approves them).
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const analysis = await approveReferenceAnalysis(
      { companyId: session.user.companyId, userId: session.user.id },
      id
    );

    return NextResponse.json({ data: analysis });
  } catch (error) {
    return handleApiError(error);
  }
}
