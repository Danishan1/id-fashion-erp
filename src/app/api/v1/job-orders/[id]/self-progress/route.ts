import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { submitSelfProgressEntrySchema } from "@/modules/production/production.schema";
import { submitSelfProgressEntry } from "@/modules/production/job-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Coarse gate here; submitSelfProgressEntry() re-verifies the caller's own
// linked Employee, that Employee's selfEntryEnabled flag, and their real
// assignment on this job order — "create" alone never lets a worker credit
// someone else's work.
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "create");

    const { id } = await params;
    const input = submitSelfProgressEntrySchema.parse(await req.json());
    const entry = await submitSelfProgressEntry(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: entry }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
