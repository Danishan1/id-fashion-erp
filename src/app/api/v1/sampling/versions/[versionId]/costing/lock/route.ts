import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { lockSampleCosting } from "@/modules/sampling/sample.service";

interface RouteContext {
  params: Promise<{ versionId: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    // Gated on "approve", not "edit" — a merchandiser (edit) builds the
    // costing sheet, only someone with approval authority (Management, or a
    // Sampling Manager who holds both) can freeze it.
    await PermissionService.assert(session.user.id, "sampling", "approve");

    const { versionId } = await params;
    const version = await lockSampleCosting(
      { companyId: session.user.companyId, userId: session.user.id },
      versionId
    );

    return NextResponse.json({ data: version });
  } catch (error) {
    return handleApiError(error);
  }
}
