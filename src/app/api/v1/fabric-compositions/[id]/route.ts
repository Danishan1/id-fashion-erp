import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { fabricCompositionSchema } from "@/modules/fabric-config/fabric-config.schema";
import { updateFabricComposition } from "@/modules/fabric-config/fabric-config.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const input = fabricCompositionSchema.parse(await req.json());
    const composition = await updateFabricComposition({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: composition });
  } catch (error) {
    return handleApiError(error);
  }
}
