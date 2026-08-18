import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { fabricWidthSchema } from "@/modules/fabric-config/fabric-config.schema";
import { updateFabricWidth } from "@/modules/fabric-config/fabric-config.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const input = fabricWidthSchema.parse(await req.json());
    const width = await updateFabricWidth({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: width });
  } catch (error) {
    return handleApiError(error);
  }
}
