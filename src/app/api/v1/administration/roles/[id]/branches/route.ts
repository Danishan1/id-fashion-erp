import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getRoleBranchAccess, updateRoleBranches } from "@/modules/administration/role-admin.service";
import { updateRoleBranchesSchema } from "@/modules/administration/role-admin.schema";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_roles", "view");

    const { id } = await params;
    const access = await getRoleBranchAccess(session.user.companyId, id);
    return NextResponse.json({ data: access });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_roles", "edit");

    const { id } = await params;
    const input = updateRoleBranchesSchema.parse(await req.json());
    const access = await updateRoleBranches({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: access });
  } catch (error) {
    return handleApiError(error);
  }
}
