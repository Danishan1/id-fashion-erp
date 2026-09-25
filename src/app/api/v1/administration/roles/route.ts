import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createRole, listRoles } from "@/modules/administration/role-admin.service";
import { createRoleSchema } from "@/modules/administration/role-admin.schema";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_roles", "view");

    const roles = await listRoles(session.user.companyId);
    return NextResponse.json({ data: roles });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_roles", "create");

    const input = createRoleSchema.parse(await req.json());
    const role = await createRole({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: role }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
