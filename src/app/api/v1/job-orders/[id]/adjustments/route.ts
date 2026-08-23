import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createAdjustmentEntrySchema } from "@/modules/production/production.schema";
import { recordAdjustmentEntry } from "@/modules/production/job-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Gated on "edit" (not "create", which a plain progress entry uses) — a
// genuine data-entry correction is a distinct, higher-scrutiny action from
// routine worker logging.
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "edit");

    const { id } = await params;
    const input = createAdjustmentEntrySchema.parse(await req.json());
    const jobOrder = await recordAdjustmentEntry(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: jobOrder }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
