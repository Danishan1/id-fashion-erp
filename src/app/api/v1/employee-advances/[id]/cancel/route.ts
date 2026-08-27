import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { cancelEmployeeAdvance } from "@/modules/accounts/employee-advance.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "expenses", "cancel");

    const { id } = await params;
    const advance = await cancelEmployeeAdvance({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: advance });
  } catch (error) {
    return handleApiError(error);
  }
}
