import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listImages } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Every generated image across every generation for this project — backs the Step 9 gallery so it survives a page reload. */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "view");

    const { id } = await params;
    const images = await listImages(session.user.companyId, id);

    return NextResponse.json({ data: images });
  } catch (error) {
    return handleApiError(error);
  }
}
