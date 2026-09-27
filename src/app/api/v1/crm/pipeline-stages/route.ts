import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { pipelineStageSchema } from "@/modules/crm/crm-config.schema";
import { listPipelineStages, createPipelineStage } from "@/modules/crm/crm-config.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "view");
    const activeOnly = req.nextUrl.searchParams.get("activeOnly") === "true";
    return NextResponse.json({ data: await listPipelineStages(session.user.companyId, "LEAD", { activeOnly }) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Configuration changes — same "crm.edit" gate as the existing CRM
    // Settings (lead-quality thresholds) endpoint.
    await PermissionService.assert(session.user.id, "crm", "edit");
    const input = pipelineStageSchema.parse(await req.json());
    const record = await createPipelineStage({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: record }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
