import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { aiGarmentProjectUpdateSchema } from "@/modules/ai-garment-flow/ai-garment-project.schema";
import { getAiGarmentProjectById, updateAiGarmentProject } from "@/modules/ai-garment-flow/ai-garment-project.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "view");

    const { id } = await params;
    const project = await getAiGarmentProjectById(session.user.companyId, id);

    return NextResponse.json({ data: project });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const input = aiGarmentProjectUpdateSchema.parse(await req.json());
    const project = await updateAiGarmentProject(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: project });
  } catch (error) {
    return handleApiError(error);
  }
}
