import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { defectTypeSchema } from "@/modules/production/production.schema";
import { createDefectType, listDefectTypes } from "@/modules/production/defect-type.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");

    const data = await listDefectTypes(session.user.companyId);

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "create");

    const input = defectTypeSchema.parse(await req.json());
    const defectType = await createDefectType(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: defectType }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
