import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { forwardJobOrderSchema } from "@/modules/production/production.schema";
import { forwardJobOrder } from "@/modules/production/job-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// No route-level check beyond "edit" for the common case — forwardJobOrder()
// itself asserts "production.approve" internally only when the resolved
// target stage is a skip ahead of the immediate next stage.
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "edit");

    const { id } = await params;
    const input = forwardJobOrderSchema.parse(await req.json());
    const jobOrder = await forwardJobOrder(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: jobOrder }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
