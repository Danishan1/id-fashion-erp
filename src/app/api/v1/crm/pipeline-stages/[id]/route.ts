import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { pipelineStageSchema } from "@/modules/crm/crm-config.schema";
import { updatePipelineStage } from "@/modules/crm/crm-config.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "edit");
    const { id } = await params;
    const input = pipelineStageSchema.parse(await req.json());
    const record = await updatePipelineStage({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: record });
  } catch (error) {
    return handleApiError(error);
  }
}
