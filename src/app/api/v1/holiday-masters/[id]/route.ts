import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { holidayMasterSchema } from "@/modules/hr-config/hr-config.schema";
import { updateHolidayMaster } from "@/modules/hr-config/hr-config.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const input = holidayMasterSchema.parse(await req.json());
    const holiday = await updateHolidayMaster({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: holiday });
  } catch (error) {
    return handleApiError(error);
  }
}
