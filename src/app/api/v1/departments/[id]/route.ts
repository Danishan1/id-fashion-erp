import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { departmentSchema } from "@/modules/departments/department.schema";
import { getDepartmentById, updateDepartment } from "@/modules/departments/department.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters", "view");

    const { id } = await params;
    const department = await getDepartmentById(session.user.companyId, id);
    return NextResponse.json({ data: department });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters", "edit");

    const { id } = await params;
    const input = departmentSchema.parse(await req.json());
    const department = await updateDepartment({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: department });
  } catch (error) {
    return handleApiError(error);
  }
}
