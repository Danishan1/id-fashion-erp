import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { employeeLoginSchema } from "@/modules/employees/employee.schema";
import { createLoginForEmployee } from "@/modules/employees/employee.service";

/**
 * P2: create an ERP login for an existing employee. The username is the
 * employee's email; the password is the temporary one and must be changed at
 * first sign-in. administration_users.create is checked inside the service.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");
    const { id } = await params;

    const input = employeeLoginSchema.parse(await req.json());
    const user = await createLoginForEmployee({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json(
      { data: { userId: user.id, email: user.email, mustChangePassword: true } },
      { status: 201, headers: { "x-toast-success": "Login created. Temporary password issued." } }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
