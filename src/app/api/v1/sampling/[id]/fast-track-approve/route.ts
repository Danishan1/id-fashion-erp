import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { fastTrackApprovalSchema } from "@/modules/sampling/sample.schema";
import { fastTrackApproveSample } from "@/modules/sampling/sample.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * "Mark as Approved (Skip Development)" — coarse check only, the real,
 * self-approval-guarded check lives inside fastTrackApproveSample() itself
 * (it needs the request's own requestedByUserId, which only exists after
 * fetching it) — same "route does an early-rejection coarse check, the
 * service owns the authoritative one" shape as the customer-decision route.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "approve");

    const { id } = await params;
    const input = fastTrackApprovalSchema.parse(await req.json().catch(() => ({})));
    const result = await fastTrackApproveSample({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
