import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { designDirectionDecisionSchema } from "@/modules/ai-garment-flow/development-brief.schema";
import { decideDesignDirection } from "@/modules/ai-garment-flow/development-brief.service";

interface RouteContext {
  params: Promise<{ directionId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { directionId } = await params;
    const input = designDirectionDecisionSchema.parse(await req.json());
    const direction = await decideDesignDirection(
      { companyId: session.user.companyId, userId: session.user.id },
      directionId,
      input
    );

    return NextResponse.json({ data: direction });
  } catch (error) {
    return handleApiError(error);
  }
}
