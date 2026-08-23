import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { sampleApprovalSchema } from "@/modules/sampling/sample.schema";
import { recordSampleApproval } from "@/modules/sampling/sample.service";
import { SampleVersionRepository } from "@/modules/sampling/sample.repository";

interface RouteContext {
  params: Promise<{ versionId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();

    const { versionId } = await params;
    const input = sampleApprovalSchema.parse(await req.json());

    const version = await SampleVersionRepository.findWithRequestOwner(versionId);
    if (!version || version.sampleRequest.companyId !== session.user.companyId) {
      throw new BusinessRuleError("NOT_FOUND", "Sample version not found.", { id: versionId });
    }

    // APPROVED needs "approve" (self-approval guarded); REJECTED/REVISION_REQUESTED
    // is a lighter-weight call, gated on "reject" — matches the sampling module's
    // rbac.ts permission split (some roles get view+approve+reject, not create/edit).
    const action = input.decision === "APPROVED" ? "approve" : "reject";
    await PermissionService.assert(session.user.id, "sampling", action, {
      createdBy: version.sampleRequest.requestedByUserId,
    });

    const result = await recordSampleApproval({ companyId: session.user.companyId, userId: session.user.id }, versionId, input);

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
