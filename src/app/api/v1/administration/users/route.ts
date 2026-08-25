import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createUser, listUsers } from "@/modules/administration/user-admin.service";
import { createUserSchema } from "@/modules/administration/user-admin.schema";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration", "view");

    const users = await listUsers(session.user.companyId);
    return NextResponse.json({ data: users });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration", "create");

    const input = createUserSchema.parse(await req.json());
    const user = await createUser({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: user }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
