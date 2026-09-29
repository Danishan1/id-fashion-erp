import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { addExtraProductionQuantitySchema } from "@/modules/production/production.schema";
import { addExtraProductionQuantity } from "@/modules/production/production-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Adds extra quantity to an existing Production Order (only once its planned quantity is fully processed). */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "edit");

    const { id } = await params;
    const input = addExtraProductionQuantitySchema.parse(await req.json());
    const actor = { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId };

    const change = await addExtraProductionQuantity(actor, id, input);

    return NextResponse.json({ data: change }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
