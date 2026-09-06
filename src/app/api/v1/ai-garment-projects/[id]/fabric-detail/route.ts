import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { fabricDetailSchema } from "@/modules/ai-garment-flow/ai-garment-project.schema";
import { upsertFabricDetail } from "@/modules/ai-garment-flow/ai-garment-project.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const input = fabricDetailSchema.parse(await req.json());
    const detail = await upsertFabricDetail(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      input
    );

    return NextResponse.json({ data: detail });
  } catch (error) {
    return handleApiError(error);
  }
}
