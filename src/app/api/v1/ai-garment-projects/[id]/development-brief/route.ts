import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createDevelopmentBriefSchema } from "@/modules/ai-garment-flow/development-brief.schema";
import { createDevelopmentBrief } from "@/modules/ai-garment-flow/development-brief.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const input = createDevelopmentBriefSchema.parse(await req.json());
    const directions = await createDevelopmentBrief(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      input
    );

    return NextResponse.json({ data: directions }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
