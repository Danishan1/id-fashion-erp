import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateDealSchema } from "@/modules/crm/deal.schema";
import { getDealById, updateDeal } from "@/modules/crm/deal.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "view");

    const { id } = await params;
    const deal = await getDealById(session.user.companyId, id);

    return NextResponse.json({ data: deal });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "edit");

    const { id } = await params;
    const input = updateDealSchema.parse(await req.json());
    const deal = await updateDeal(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: deal });
  } catch (error) {
    return handleApiError(error);
  }
}
