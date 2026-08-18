import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { designationSchema } from "@/modules/hr-config/hr-config.schema";
import { updateDesignation } from "@/modules/hr-config/hr-config.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const input = designationSchema.parse(await req.json());
    const designation = await updateDesignation({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: designation });
  } catch (error) {
    return handleApiError(error);
  }
}
