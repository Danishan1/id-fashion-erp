import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { shiftMasterSchema } from "@/modules/hr-config/hr-config.schema";
import { updateShiftMaster } from "@/modules/hr-config/hr-config.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const input = shiftMasterSchema.parse(await req.json());
    const shift = await updateShiftMaster({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: shift });
  } catch (error) {
    return handleApiError(error);
  }
}
