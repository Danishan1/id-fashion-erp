import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { jobWorkOrderStatusChangeSchema } from "@/modules/production/job-work-order.schema";
import { transitionJobWorkOrderStatus } from "@/modules/production/job-work-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    const input = jobWorkOrderStatusChangeSchema.parse(await req.json());
    await PermissionService.assert(session.user.id, "production", input.status === "CANCELLED" ? "cancel" : "edit");

    const { id } = await params;
    const order = await transitionJobWorkOrderStatus(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input.status
    );

    return NextResponse.json({ data: order });
  } catch (error) {
    return handleApiError(error);
  }
}
