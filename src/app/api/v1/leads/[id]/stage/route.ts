import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { changeLeadStageSchema } from "@/modules/crm/lead.schema";
import { changeLeadStage } from "@/modules/crm/lead.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "edit");

    const { id } = await params;
    const input = changeLeadStageSchema.parse(await req.json());
    const lead = await changeLeadStage(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );
    return NextResponse.json({ data: lead });
  } catch (error) {
    return handleApiError(error);
  }
}
