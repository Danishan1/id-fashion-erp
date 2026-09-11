import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { sampleRequestDesignNameSchema } from "@/modules/sampling/sample.schema";
import { updateSampleRequestDesignName } from "@/modules/sampling/sample.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "edit");

    const { id } = await params;
    const { styleName } = sampleRequestDesignNameSchema.parse(await req.json());
    const request = await updateSampleRequestDesignName(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      styleName
    );

    return NextResponse.json({ data: request });
  } catch (error) {
    return handleApiError(error);
  }
}
