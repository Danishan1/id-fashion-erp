import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateDispatchSchema } from "@/modules/dispatch/dispatch.schema";
import { getDispatchById, updateDispatch } from "@/modules/dispatch/dispatch.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "dispatch", "view");

    const { id } = await params;
    const dispatch = await getDispatchById(session.user.companyId, id);

    return NextResponse.json({ data: dispatch });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "dispatch", "edit");

    const { id } = await params;
    const input = updateDispatchSchema.parse(await req.json());
    const dispatch = await updateDispatch(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: dispatch });
  } catch (error) {
    return handleApiError(error);
  }
}
