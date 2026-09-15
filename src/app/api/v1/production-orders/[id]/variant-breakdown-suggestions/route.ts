import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getVariantBreakdownSuggestions } from "@/modules/production/lot.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view");

    const { id } = await params;
    const rows = await getVariantBreakdownSuggestions(session.user.companyId, id);

    return NextResponse.json({ data: rows });
  } catch (error) {
    return handleApiError(error);
  }
}
