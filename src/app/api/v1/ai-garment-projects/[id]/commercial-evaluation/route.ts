import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createCommercialEvaluationSchema } from "@/modules/ai-garment-flow/commercial-evaluation.schema";
import { createCommercialEvaluation, getLatestCommercialEvaluation } from "@/modules/ai-garment-flow/commercial-evaluation.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "view");

    const { id } = await params;
    const evaluation = await getLatestCommercialEvaluation(session.user.companyId, id);

    return NextResponse.json({ data: evaluation });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const input = createCommercialEvaluationSchema.parse(await req.json());
    const evaluation = await createCommercialEvaluation({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: evaluation }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
