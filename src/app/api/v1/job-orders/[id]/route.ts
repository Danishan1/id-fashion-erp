import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getJobOrderById } from "@/modules/production/job-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view");

    const { id } = await params;
    const jobOrder = await getJobOrderById(session.user.companyId, id, session.user.id);

    return NextResponse.json({ data: jobOrder });
  } catch (error) {
    return handleApiError(error);
  }
}
