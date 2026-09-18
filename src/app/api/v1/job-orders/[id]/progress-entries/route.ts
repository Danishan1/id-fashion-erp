import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createProgressEntrySchema } from "@/modules/production/production.schema";
import { recordProgressEntry } from "@/modules/production/job-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "create");

    const { id } = await params;
    const input = createProgressEntrySchema.parse(await req.json());
    // Discriminated return (2026-09-18) — { status: "APPLIED", jobOrder }
    // when the entry applied immediately (the pre-existing behavior), or
    // { status: "PENDING", entry } when ProductionSettings.
    // supervisorApprovalRequired routes it through the approval queue
    // instead.
    const result = await recordProgressEntry(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
