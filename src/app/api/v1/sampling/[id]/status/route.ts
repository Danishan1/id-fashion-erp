import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { sampleStatusChangeSchema } from "@/modules/sampling/sample.schema";
import { transitionSampleStatus } from "@/modules/sampling/sample.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    // No route-level assert here — which permission applies (sampling.edit
    // vs. qc.edit for the Internal QC gate) depends on the record's CURRENT
    // status, which only exists after transitionSampleStatus() fetches it.
    // The real, authoritative check now lives inside that function itself
    // (RBAC audit, 2026-09-24 — same "coarse route check impossible without
    // the record, so skip it and let the service own it" shape already used
    // by approvePurchaseOrder()).

    const { id } = await params;
    const { status } = sampleStatusChangeSchema.parse(await req.json());
    const request = await transitionSampleStatus(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      status
    );

    return NextResponse.json({ data: request });
  } catch (error) {
    return handleApiError(error);
  }
}
