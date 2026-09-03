import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { fabricDyeTypeSchema } from "@/modules/fabric-config/fabric-config.schema";
import { updateFabricDyeType } from "@/modules/fabric-config/fabric-config.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const input = fabricDyeTypeSchema.parse(await req.json());
    const dyeType = await updateFabricDyeType({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: dyeType });
  } catch (error) {
    return handleApiError(error);
  }
}
