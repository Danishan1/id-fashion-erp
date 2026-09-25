import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { resumeMaterialRequestFromHold } from "@/modules/inventory/material-request.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "material_request", "edit");

    const { id } = await params;
    const request = await resumeMaterialRequestFromHold({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: request });
  } catch (error) {
    return handleApiError(error);
  }
}
