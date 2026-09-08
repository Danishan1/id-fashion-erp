import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { technicalSpecificationDecisionSchema } from "@/modules/ai-garment-flow/technical-specification.schema";
import { decideTechnicalSpecification } from "@/modules/ai-garment-flow/technical-specification.service";

interface RouteContext {
  params: Promise<{ specId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { specId } = await params;
    const input = technicalSpecificationDecisionSchema.parse(await req.json());
    const spec = await decideTechnicalSpecification({ companyId: session.user.companyId, userId: session.user.id }, specId, input);

    return NextResponse.json({ data: spec });
  } catch (error) {
    return handleApiError(error);
  }
}
