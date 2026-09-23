import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { decideMaterialRequestApprovalSchema } from "@/modules/inventory/material-request.schema";
import { approveMaterialRequest } from "@/modules/inventory/material-request.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** A coarse door-check here (module-level, no resourceContext) — the real,
 * self-approval-guarded gate lives inside approveMaterialRequest() itself. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "approve");

    const { id } = await params;
    const input = decideMaterialRequestApprovalSchema.parse(await req.json().catch(() => ({})));
    const request = await approveMaterialRequest({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: request });
  } catch (error) {
    return handleApiError(error);
  }
}
