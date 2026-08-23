import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createQcInspectionSchema } from "@/modules/production/production.schema";
import { recordQcInspection } from "@/modules/production/job-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Uses the existing "qc" module, not "production" — QC_MANAGER already has
// full qc CRUD seeded, PRODUCTION_SUPERVISOR has qc.create for smaller
// companies without a dedicated inspector role.
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "qc", "create");

    const { id } = await params;
    const input = createQcInspectionSchema.parse(await req.json());
    const inspection = await recordQcInspection(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: inspection }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
