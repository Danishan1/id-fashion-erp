import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { employeeUpdateSchema } from "@/modules/employees/employee.schema";
import { getEmployeeById, updateEmployee, deactivateEmployee } from "@/modules/employees/employee.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");

    const { id } = await params;
    const employee = await getEmployeeById(session.user.companyId, id);
    return NextResponse.json({ data: employee });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const input = employeeUpdateSchema.parse(await req.json());
    const employee = await updateEmployee({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: employee });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "delete");

    const { id } = await params;
    await deactivateEmployee({ companyId: session.user.companyId, userId: session.user.id }, id);
    return NextResponse.json({ data: { id } });
  } catch (error) {
    return handleApiError(error);
  }
}
