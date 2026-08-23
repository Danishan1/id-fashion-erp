import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { sampleOtherChargeSchema } from "@/modules/sampling/sample.schema";
import { addSampleOtherCharge } from "@/modules/sampling/sample.service";

interface RouteContext {
  params: Promise<{ versionId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "edit");

    const { versionId } = await params;
    const input = sampleOtherChargeSchema.parse(await req.json());
    const charges = await addSampleOtherCharge(
      { companyId: session.user.companyId, userId: session.user.id },
      versionId,
      input
    );

    return NextResponse.json({ data: charges }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
