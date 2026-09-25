import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { removeUserBranchRole } from "@/modules/administration/user-admin.service";

interface RouteContext {
  params: Promise<{ id: string; branchRoleId: string }>;
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_users", "edit");

    const { id, branchRoleId } = await params;
    const user = await removeUserBranchRole({ companyId: session.user.companyId, userId: session.user.id }, id, branchRoleId);
    return NextResponse.json({ data: user });
  } catch (error) {
    return handleApiError(error);
  }
}
