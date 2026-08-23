import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { startLotSchema } from "@/modules/production/production.schema";
import { startLot } from "@/modules/production/job-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "edit");

    const { id } = await params;
    const input = startLotSchema.parse(await req.json().catch(() => ({})));
    const jobOrder = await startLot(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: jobOrder }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
