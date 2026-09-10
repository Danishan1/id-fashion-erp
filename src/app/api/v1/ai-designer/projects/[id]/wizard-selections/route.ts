import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { saveWizardSelectionsSchema } from "@/modules/ai-designer/ai-designer.schema";
import { saveWizardSelections } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Steps 3-8 — Target Customer / Age Group / Product Category / Design / Model / Environment, one incremental PATCH. */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const input = saveWizardSelectionsSchema.parse(await req.json());
    const project = await saveWizardSelections({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: project });
  } catch (error) {
    return handleApiError(error);
  }
}
