import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { addUserBranchRole } from "@/modules/administration/user-admin.service";
import { addUserBranchRoleSchema } from "@/modules/administration/user-admin.schema";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_users", "edit");

    const { id } = await params;
    const input = addUserBranchRoleSchema.parse(await req.json());
    const user = await addUserBranchRole({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: user }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
