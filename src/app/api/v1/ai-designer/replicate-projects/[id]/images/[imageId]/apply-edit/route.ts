import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { applyReplicateEditVariationSchema } from "@/modules/ai-designer/replicate-design.schema";
import { applyReplicateEditVariation } from "@/modules/ai-designer/replicate-design.service";

interface RouteContext {
  params: Promise<{ id: string; imageId: string }>;
}

/** The explicit "Apply" action — promotes one previewed image to a real new ReplicateDesignVersion. Distinct from images/[imageId]/decide (a cosmetic Select/Reject mark that never changes the current design). */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { imageId } = await params;
    const input = applyReplicateEditVariationSchema.parse(await req.json());
    const version = await applyReplicateEditVariation({ companyId: session.user.companyId, userId: session.user.id }, imageId, input);

    return NextResponse.json({ data: version }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
