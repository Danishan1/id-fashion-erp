import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { removeUserOverride } from "@/modules/administration/permission-override.service";

interface RouteContext {
  params: Promise<{ id: string; overrideId: string }>;
}

/** P6: remove one override; the user falls back to what their roles grant. */
export async function DELETE(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_users", "edit");
    const { id, overrideId } = await params;
    await removeUserOverride({ companyId: session.user.companyId, userId: session.user.id }, id, overrideId);
    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    return handleApiError(error);
  }
}
