import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { cancelEmployeeAdvanceSettlement } from "@/modules/accounts/employee-advance.service";

interface RouteContext {
  params: Promise<{ settlementId: string }>;
}

export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "expenses", "cancel");

    const { settlementId } = await params;
    const settlement = await cancelEmployeeAdvanceSettlement({ companyId: session.user.companyId, userId: session.user.id }, settlementId);

    return NextResponse.json({ data: settlement });
  } catch (error) {
    return handleApiError(error);
  }
}
