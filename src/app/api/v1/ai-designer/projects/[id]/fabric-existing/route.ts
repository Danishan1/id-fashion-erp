import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { selectExistingFabricSchema } from "@/modules/ai-designer/ai-designer.schema";
import { selectExistingFabric } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Step 1, "pick an existing fabric" branch. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const input = selectExistingFabricSchema.parse(await req.json());
    const project = await selectExistingFabric({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: project });
  } catch (error) {
    return handleApiError(error);
  }
}
