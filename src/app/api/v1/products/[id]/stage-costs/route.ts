import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { saveStageCostsSchema } from "@/modules/stage-costs/stage-cost.schema";
import { getStyleStageCosts, saveStyleStageCosts } from "@/modules/stage-costs/stage-cost.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Master Style → Stage → default job-work cost. */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");
    const { id } = await params;
    return NextResponse.json({ data: await getStyleStageCosts(session.user.companyId, id) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");
    const { id } = await params;
    const input = saveStageCostsSchema.parse(await req.json());
    const data = await saveStyleStageCosts({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
