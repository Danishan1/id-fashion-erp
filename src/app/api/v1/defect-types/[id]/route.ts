import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { defectTypeSchema } from "@/modules/production/production.schema";
import { updateDefectType } from "@/modules/production/defect-type.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const body = await req.json();
    const input = defectTypeSchema.parse(body);
    const defectType = await updateDefectType(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      { ...input, isActive: typeof body.isActive === "boolean" ? body.isActive : undefined }
    );

    return NextResponse.json({ data: defectType });
  } catch (error) {
    return handleApiError(error);
  }
}
