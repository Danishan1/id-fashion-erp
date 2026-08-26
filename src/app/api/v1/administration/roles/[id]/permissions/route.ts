import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getRolePermissionMatrix, updateRolePermissions } from "@/modules/administration/role-admin.service";
import { updateRolePermissionsSchema } from "@/modules/administration/role-admin.schema";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration", "view");

    const { id } = await params;
    const matrix = await getRolePermissionMatrix(session.user.companyId, id);
    return NextResponse.json({ data: matrix });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration", "edit");

    const { id } = await params;
    const { grantedKeys } = updateRolePermissionsSchema.parse(await req.json());
    const matrix = await updateRolePermissions({ companyId: session.user.companyId, userId: session.user.id }, id, grantedKeys);
    return NextResponse.json({ data: matrix });
  } catch (error) {
    return handleApiError(error);
  }
}
