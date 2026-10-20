import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { assertLotInScope } from "@/modules/production/production-scope";
import { getLotGenealogy } from "@/modules/production/lot.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view");

    const { id } = await params;
    await assertLotInScope({ companyId: session.user.companyId, userId: session.user.id }, id);
    const relations = await getLotGenealogy(session.user.companyId, id);

    return NextResponse.json({ data: relations });
  } catch (error) {
    return handleApiError(error);
  }
}
