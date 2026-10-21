import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { assertProductionOrderInScope } from "@/modules/production/production-scope";
import { saveColorFabricPlanSchema } from "@/modules/production/production.schema";
import { getColorFabricPlan, saveColorFabricPlan } from "@/modules/production/color-fabric-plan.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Colour-wise fabric plan: per garment colour x BOM fabric line, the fabric, fabric colour and quantity to request. */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view_all");
    const { id } = await params;
    await assertProductionOrderInScope({ companyId: session.user.companyId, userId: session.user.id }, id);
    return NextResponse.json({ data: await getColorFabricPlan(session.user.companyId, id) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "edit");
    const { id } = await params;
    await assertProductionOrderInScope({ companyId: session.user.companyId, userId: session.user.id }, id);
    const input = saveColorFabricPlanSchema.parse(await req.json());
    const plan = await saveColorFabricPlan({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: plan });
  } catch (error) {
    return handleApiError(error);
  }
}
