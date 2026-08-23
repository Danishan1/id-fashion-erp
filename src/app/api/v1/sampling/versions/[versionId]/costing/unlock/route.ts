import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { unlockSampleCosting } from "@/modules/sampling/sample.service";

interface RouteContext {
  params: Promise<{ versionId: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "approve");

    const { versionId } = await params;
    const version = await unlockSampleCosting(
      { companyId: session.user.companyId, userId: session.user.id },
      versionId
    );

    return NextResponse.json({ data: version });
  } catch (error) {
    return handleApiError(error);
  }
}
