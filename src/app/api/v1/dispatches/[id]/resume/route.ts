import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { resumeDispatchFromHold } from "@/modules/dispatch/dispatch.service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "dispatch", "edit");

    const { id } = await params;
    const dispatch = await resumeDispatchFromHold({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: dispatch });
  } catch (error) {
    return handleApiError(error);
  }
}
