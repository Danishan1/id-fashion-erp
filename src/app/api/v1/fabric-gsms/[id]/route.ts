import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { fabricGsmSchema } from "@/modules/fabric-config/fabric-config.schema";
import { updateFabricGsm } from "@/modules/fabric-config/fabric-config.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const input = fabricGsmSchema.parse(await req.json());
    const gsm = await updateFabricGsm({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: gsm });
  } catch (error) {
    return handleApiError(error);
  }
}
