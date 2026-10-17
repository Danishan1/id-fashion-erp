import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { generateMissingOptionFlats } from "@/modules/ai-designer/ai-designer-attribute-master.service";

/**
 * Generates the next few missing construction-option CAD flats. The Masters
 * page calls this repeatedly until `remaining` is 0, so each request stays short.
 */
export async function POST() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");
    const data = await generateMissingOptionFlats({ companyId: session.user.companyId, userId: session.user.id });
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
