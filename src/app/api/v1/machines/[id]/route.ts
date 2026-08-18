import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { machineSchema } from "@/modules/production-config/production-config.schema";
import { updateMachine } from "@/modules/production-config/production-config.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const input = machineSchema.parse(await req.json());
    const machine = await updateMachine({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: machine });
  } catch (error) {
    return handleApiError(error);
  }
}
