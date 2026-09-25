import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { resetUserPassword } from "@/modules/administration/user-admin.service";
import { resetUserPasswordSchema } from "@/modules/administration/user-admin.schema";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_users", "edit");

    const { id } = await params;
    const { newPassword } = resetUserPasswordSchema.parse(await req.json());
    await resetUserPassword({ companyId: session.user.companyId, userId: session.user.id }, id, newPassword);
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return handleApiError(error);
  }
}
