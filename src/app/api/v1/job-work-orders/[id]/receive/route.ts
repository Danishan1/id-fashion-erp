import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { receiveJobWorkSchema } from "@/modules/production/job-work-order.schema";
import { receiveJobWork } from "@/modules/production/job-work-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "create");

    const { id } = await params;
    const input = receiveJobWorkSchema.parse(await req.json());
    const receipt = await receiveJobWork(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: receipt }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
