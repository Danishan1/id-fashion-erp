import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { confirmDispatch } from "@/modules/dispatch/dispatch.service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // Coarse gate here; confirmDispatch() re-asserts "post" internally with
    // resourceContext.createdBy, which is what enforces self-approval.
    await PermissionService.assert(session.user.id, "dispatch", "post");

    const { id } = await params;
    const dispatch = await confirmDispatch(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id
    );

    return NextResponse.json({ data: dispatch });
  } catch (error) {
    return handleApiError(error);
  }
}
