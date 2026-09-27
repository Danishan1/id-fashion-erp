import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getLeadHistory } from "@/modules/crm/lead.service";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "view");

    const { id } = await params;
    return NextResponse.json({ data: await getLeadHistory(session.user.companyId, id) });
  } catch (error) {
    return handleApiError(error);
  }
}
