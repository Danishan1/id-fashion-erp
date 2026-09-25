import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateMaterialRequestSchema } from "@/modules/inventory/material-request.schema";
import { getMaterialRequestById, updateMaterialRequestLines } from "@/modules/inventory/material-request.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "material_request", "view");

    const { id } = await params;
    const request = await getMaterialRequestById({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: request });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "material_request", "edit");

    const { id } = await params;
    const input = updateMaterialRequestSchema.parse(await req.json());
    const request = await updateMaterialRequestLines(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: request });
  } catch (error) {
    return handleApiError(error);
  }
}
