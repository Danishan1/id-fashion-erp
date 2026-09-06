import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { saveWorkflowStepSchema } from "@/modules/ai-garment-flow/ai-garment-project.schema";
import { saveWorkflowStep } from "@/modules/ai-garment-flow/ai-garment-project.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const input = saveWorkflowStepSchema.parse(await req.json());
    const project = await saveWorkflowStep(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      input
    );

    return NextResponse.json({ data: project });
  } catch (error) {
    return handleApiError(error);
  }
}
