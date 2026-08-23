import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { sampleOtherChargeSchema } from "@/modules/sampling/sample.schema";
import { deleteSampleOtherCharge, updateSampleOtherCharge } from "@/modules/sampling/sample.service";

interface RouteContext {
  params: Promise<{ chargeId: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "edit");

    const { chargeId } = await params;
    const input = sampleOtherChargeSchema.parse(await req.json());
    const charges = await updateSampleOtherCharge(
      { companyId: session.user.companyId, userId: session.user.id },
      chargeId,
      input
    );

    return NextResponse.json({ data: charges });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "edit");

    const { chargeId } = await params;
    const charges = await deleteSampleOtherCharge(
      { companyId: session.user.companyId, userId: session.user.id },
      chargeId
    );

    return NextResponse.json({ data: charges });
  } catch (error) {
    return handleApiError(error);
  }
}
