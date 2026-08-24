import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getJobWorkOrderById } from "@/modules/production/job-work-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view");

    const { id } = await params;
    const order = await getJobWorkOrderById(session.user.companyId, id);

    return NextResponse.json({ data: order });
  } catch (error) {
    return handleApiError(error);
  }
}
