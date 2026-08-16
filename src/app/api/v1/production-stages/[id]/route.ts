import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { productionStageSchema } from "@/modules/production-config/production-config.schema";
import { updateProductionStage } from "@/modules/production-config/production-config.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters", "edit");

    const { id } = await params;
    const input = productionStageSchema.parse(await req.json());
    const stage = await updateProductionStage({ companyId: session.user.companyId }, id, input);
    return NextResponse.json({ data: stage });
  } catch (error) {
    return handleApiError(error);
  }
}
