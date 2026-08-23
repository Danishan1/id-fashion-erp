import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { sampleMaterialSchema } from "@/modules/sampling/sample.schema";
import { addSampleMaterial } from "@/modules/sampling/sample.service";

interface RouteContext {
  params: Promise<{ versionId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "edit");

    const { versionId } = await params;
    const input = sampleMaterialSchema.parse(await req.json());
    const materials = await addSampleMaterial(
      { companyId: session.user.companyId, userId: session.user.id },
      versionId,
      input
    );

    return NextResponse.json({ data: materials }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
