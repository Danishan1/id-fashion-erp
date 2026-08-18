import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { costMasterSchema } from "@/modules/cost-master/cost-master.schema";
import { updateCostMaster } from "@/modules/cost-master/cost-master.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_finance", "edit");

    const { id } = await params;
    const input = costMasterSchema.parse(await req.json());
    const costMaster = await updateCostMaster({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: costMaster });
  } catch (error) {
    return handleApiError(error);
  }
}
