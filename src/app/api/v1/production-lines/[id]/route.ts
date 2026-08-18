import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { productionLineSchema } from "@/modules/production-config/production-config.schema";
import { updateProductionLine } from "@/modules/production-config/production-config.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const input = productionLineSchema.parse(await req.json());
    const line = await updateProductionLine({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: line });
  } catch (error) {
    return handleApiError(error);
  }
}
