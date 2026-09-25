import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { closeMaterialRequest } from "@/modules/inventory/material-request.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    // "cancel" specifically, not "edit" — Close is the material_request.cancel
    // business action (RBAC audit, 2026-09-24), distinct from ordinary edits
    // like Resume/Issue/Substitution, which stay on material_request.edit.
    await PermissionService.assert(session.user.id, "material_request", "cancel");

    const { id } = await params;
    const request = await closeMaterialRequest({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: request });
  } catch (error) {
    return handleApiError(error);
  }
}
