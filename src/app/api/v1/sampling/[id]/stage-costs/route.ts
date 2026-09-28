import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { saveStageCostsSchema } from "@/modules/stage-costs/stage-cost.schema";
import { getDesignStageCosts, saveDesignStageCosts } from "@/modules/stage-costs/stage-cost.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** A Design's stage costs: inherited Style default, Design override, effective value. */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "view");
    const { id } = await params;
    return NextResponse.json({ data: await getDesignStageCosts(session.user.companyId, id) });
  } catch (error) {
    return handleApiError(error);
  }
}

/** `cost: null` on a stage reverts it to the inherited Style default. */
export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "edit");
    const { id } = await params;
    const input = saveStageCostsSchema.parse(await req.json());
    const data = await saveDesignStageCosts({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
