import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listHandbacks } from "@/modules/production/work-portal.service";

/** P4: hand-backs recorded on a job order. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view");
    const { id } = await params;
    const data = await listHandbacks({ companyId: session.user.companyId, userId: session.user.id }, id);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
