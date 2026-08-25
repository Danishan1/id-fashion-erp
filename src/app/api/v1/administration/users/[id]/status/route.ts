import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { setUserStatus } from "@/modules/administration/user-admin.service";
import { updateUserStatusSchema } from "@/modules/administration/user-admin.schema";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration", "edit");

    const { id } = await params;
    const { status } = updateUserStatusSchema.parse(await req.json());
    const user = await setUserStatus({ companyId: session.user.companyId, userId: session.user.id }, id, status);
    return NextResponse.json({ data: user });
  } catch (error) {
    return handleApiError(error);
  }
}
