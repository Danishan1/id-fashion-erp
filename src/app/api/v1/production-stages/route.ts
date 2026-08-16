import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { productionStageSchema } from "@/modules/production-config/production-config.schema";
import { listProductionStages, createProductionStage } from "@/modules/production-config/production-config.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters", "view");
    return NextResponse.json({ data: await listProductionStages(session.user.companyId) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters", "create");

    const input = productionStageSchema.parse(await req.json());
    const stage = await createProductionStage({ companyId: session.user.companyId }, input);
    return NextResponse.json({ data: stage }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
