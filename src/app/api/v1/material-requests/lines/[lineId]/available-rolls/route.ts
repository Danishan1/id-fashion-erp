import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getAvailableRollsForLine } from "@/modules/inventory/material-request.service";

interface RouteContext {
  params: Promise<{ lineId: string }>;
}

// The color/shade-wise stock breakdown for this line's material at its
// request's warehouse — feeds the Issue modal's roll picker. Same "edit"
// gate as the Issue action itself, since this is only ever fetched right
// before issuing.
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "edit");

    const { lineId } = await params;
    const rolls = await getAvailableRollsForLine({ companyId: session.user.companyId, userId: session.user.id }, lineId);

    return NextResponse.json({ data: rolls });
  } catch (error) {
    return handleApiError(error);
  }
}
