import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { chartOfAccountSchema } from "@/modules/accounts/chart-of-account.schema";
import { getChartOfAccountById, updateChartOfAccount } from "@/modules/accounts/chart-of-account.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "view");

    const { id } = await params;
    const account = await getChartOfAccountById(session.user.companyId, id);

    return NextResponse.json({ data: account });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "edit");

    const { id } = await params;
    const input = chartOfAccountSchema.parse(await req.json());
    const account = await updateChartOfAccount({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: account });
  } catch (error) {
    return handleApiError(error);
  }
}
