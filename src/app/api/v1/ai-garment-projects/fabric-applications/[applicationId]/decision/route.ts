import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { fabricApplicationDecisionSchema } from "@/modules/ai-garment-flow/fabric-application.schema";
import { decideFabricApplication } from "@/modules/ai-garment-flow/fabric-application.service";

interface RouteContext {
  params: Promise<{ applicationId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { applicationId } = await params;
    const input = fabricApplicationDecisionSchema.parse(await req.json());
    const application = await decideFabricApplication({ companyId: session.user.companyId, userId: session.user.id }, applicationId, input);

    return NextResponse.json({ data: application });
  } catch (error) {
    return handleApiError(error);
  }
}
