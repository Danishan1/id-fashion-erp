import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { fabricWeaveTypeSchema } from "@/modules/fabric-config/fabric-config.schema";
import { updateFabricWeaveType } from "@/modules/fabric-config/fabric-config.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const input = fabricWeaveTypeSchema.parse(await req.json());
    const weaveType = await updateFabricWeaveType({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: weaveType });
  } catch (error) {
    return handleApiError(error);
  }
}
