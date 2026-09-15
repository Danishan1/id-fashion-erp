import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { generateEditPreviewSchema } from "@/modules/ai-designer/ai-designer.schema";
import { generateEditPreview } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Edit Design workspace — generates 1-4 preview candidates for a requested change. Never overwrites the current design by itself; see images/[imageId]/apply-edit for the explicit apply step. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const input = generateEditPreviewSchema.parse(await req.json());
    const result = await generateEditPreview({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
