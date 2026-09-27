import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { makeCurrentSchema } from "@/modules/ai-designer/new-design.schema";
import { makeImageCurrent } from "@/modules/ai-designer/new-design.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");
    const { id } = await params;
    const input = makeCurrentSchema.parse(await req.json());
    const data = await makeImageCurrent({ companyId: session.user.companyId, userId: session.user.id }, id, input.imageId);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
