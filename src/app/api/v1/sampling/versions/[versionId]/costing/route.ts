import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { sampleCostingSchema } from "@/modules/sampling/sample.schema";
import { updateSampleVersionCosting } from "@/modules/sampling/sample.service";

interface RouteContext {
  params: Promise<{ versionId: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "edit");

    const { versionId } = await params;
    const input = sampleCostingSchema.parse(await req.json());
    const version = await updateSampleVersionCosting(
      { companyId: session.user.companyId, userId: session.user.id },
      versionId,
      input
    );

    return NextResponse.json({ data: version });
  } catch (error) {
    return handleApiError(error);
  }
}
