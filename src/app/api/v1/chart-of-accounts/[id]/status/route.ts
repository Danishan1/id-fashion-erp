import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { chartOfAccountStatusSchema } from "@/modules/accounts/chart-of-account.schema";
import { setChartOfAccountActiveStatus } from "@/modules/accounts/chart-of-account.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "edit");

    const { id } = await params;
    const { isActive } = chartOfAccountStatusSchema.parse(await req.json());
    const account = await setChartOfAccountActiveStatus(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      isActive
    );
    return NextResponse.json({ data: account });
  } catch (error) {
    return handleApiError(error);
  }
}
