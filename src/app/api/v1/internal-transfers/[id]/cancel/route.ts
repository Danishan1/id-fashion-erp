import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { cancelInternalTransfer } from "@/modules/accounts/internal-transfer.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "cancel");

    const { id } = await params;
    const transfer = await cancelInternalTransfer({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: transfer });
  } catch (error) {
    return handleApiError(error);
  }
}
