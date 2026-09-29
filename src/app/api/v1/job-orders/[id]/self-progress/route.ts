import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { submitSelfProgressEntrySchema } from "@/modules/production/production.schema";
import { submitSelfProgressEntry } from "@/modules/production/job-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Only Production "view" is required here (2026-09-29). What actually
// authorizes a self-entry is checked in submitSelfProgressEntry(): the
// caller's own linked Employee, its Self Entry flag, the Work Skill for this
// job order's stage, and a real assignment on it. Entries always wait for
// Supervisor approval, so a worker can never credit someone else's work.
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view");

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
