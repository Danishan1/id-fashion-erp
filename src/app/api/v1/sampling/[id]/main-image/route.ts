import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { sampleRequestSetMainImageSchema } from "@/modules/sampling/sample.schema";
import { setSampleRequestMainImage } from "@/modules/sampling/sample.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "edit");

    const { id } = await params;
    const input = sampleRequestSetMainImageSchema.parse(await req.json());
    const request = await setSampleRequestMainImage(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      input.attachmentId
    );

    return NextResponse.json({ data: request });
  } catch (error) {
    return handleApiError(error);
  }
}
