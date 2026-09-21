import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateBrandNameSchema } from "@/modules/ai-designer/ai-designer.schema";
import { getBrandDefaults, updateBrandName } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Step 12b — brand name. Resolves to the logged-in company's own name whenever the project's own brandName is unset. */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "view");

    const { id } = await params;
    const data = await getBrandDefaults(session.user.companyId, id);

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const input = updateBrandNameSchema.parse(await req.json());
    const project = await updateBrandName({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: project });
  } catch (error) {
    return handleApiError(error);
  }
}
