import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { technicalFlatDecisionSchema } from "@/modules/ai-garment-flow/technical-development.schema";
import { decideTechnicalFlat } from "@/modules/ai-garment-flow/technical-development.service";

interface RouteContext {
  params: Promise<{ flatId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { flatId } = await params;
    const input = technicalFlatDecisionSchema.parse(await req.json());
    const flat = await decideTechnicalFlat({ companyId: session.user.companyId, userId: session.user.id }, flatId, input);

    return NextResponse.json({ data: flat });
  } catch (error) {
    return handleApiError(error);
  }
}
