import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { employeeAdvanceSettlementSchema } from "@/modules/accounts/employee-advance.schema";
import { createEmployeeAdvanceSettlement } from "@/modules/accounts/employee-advance.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "expenses", "create");

    const { id } = await params;
    const input = employeeAdvanceSettlementSchema.parse(await req.json());
    const settlement = await createEmployeeAdvanceSettlement(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: settlement }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
