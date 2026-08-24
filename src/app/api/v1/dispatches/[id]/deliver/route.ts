import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { deliverDispatchSchema } from "@/modules/dispatch/dispatch.schema";
import { markDelivered } from "@/modules/dispatch/dispatch.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "dispatch", "edit");

    const { id } = await params;
    const { receivedByName } = deliverDispatchSchema.parse(await req.json().catch(() => ({})));
    const dispatch = await markDelivered(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      receivedByName
    );

    return NextResponse.json({ data: dispatch });
  } catch (error) {
    return handleApiError(error);
  }
}
