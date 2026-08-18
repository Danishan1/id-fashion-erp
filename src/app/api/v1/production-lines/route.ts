import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { productionLineSchema } from "@/modules/production-config/production-config.schema";
import { listProductionLines, createProductionLine } from "@/modules/production-config/production-config.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");
    return NextResponse.json({ data: await listProductionLines(session.user.companyId) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "create");

    const input = productionLineSchema.parse(await req.json());
    const line = await createProductionLine({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: line }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
