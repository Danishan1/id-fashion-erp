import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import {
  listUserOverrides,
  setOverrideSchema,
  setUserOverride,
} from "@/modules/administration/permission-override.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** P6: a user's per-permission grant/deny overrides. */
export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_users", "view");
    const { id } = await params;
    const data = await listUserOverrides({ companyId: session.user.companyId, userId: session.user.id }, id);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_users", "edit");
    const { id } = await params;
    const input = setOverrideSchema.parse(await req.json());
    const data = await setUserOverride({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
