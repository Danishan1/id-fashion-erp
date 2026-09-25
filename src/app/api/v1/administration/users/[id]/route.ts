import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateUser } from "@/modules/administration/user-admin.service";
import { updateUserSchema } from "@/modules/administration/user-admin.schema";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_users", "edit");

    const { id } = await params;
    const input = updateUserSchema.parse(await req.json());
    const user = await updateUser({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: user });
  } catch (error) {
    return handleApiError(error);
  }
}
