import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { materialRequestStatusChangeSchema } from "@/modules/inventory/material-request.schema";
import { transitionMaterialRequestStatus } from "@/modules/inventory/material-request.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "edit");

    const { id } = await params;
    const { status } = materialRequestStatusChangeSchema.parse(await req.json());
    const request = await transitionMaterialRequestStatus(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      status
    );

    return NextResponse.json({ data: request });
  } catch (error) {
    return handleApiError(error);
  }
}
