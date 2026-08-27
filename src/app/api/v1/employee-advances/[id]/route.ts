import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getEmployeeAdvanceById } from "@/modules/accounts/employee-advance.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "expenses", "view");

    const { id } = await params;
    const advance = await getEmployeeAdvanceById(session.user.companyId, id);

    return NextResponse.json({ data: advance });
  } catch (error) {
    return handleApiError(error);
  }
}
