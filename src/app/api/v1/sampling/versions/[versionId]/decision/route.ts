import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { sampleApprovalSchema } from "@/modules/sampling/sample.schema";
import { recordSampleApproval } from "@/modules/sampling/sample.service";

interface RouteContext {
  params: Promise<{ versionId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();

    const { versionId } = await params;
    const input = sampleApprovalSchema.parse(await req.json());

    // Coarse check only — early rejection before touching business logic.
    // The real, self-approval-guarded check (with the correct resourceContext)
    // now lives inside recordSampleApproval() itself, so it can't be bypassed
    // by any future second caller of that function.
    const action = input.decision === "APPROVED" ? "approve" : "reject";
    await PermissionService.assert(session.user.id, "sampling", action);

    const result = await recordSampleApproval({ companyId: session.user.companyId, userId: session.user.id }, versionId, input);

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
