import { NextRequest, NextResponse, after } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getLatestTechPack } from "@/modules/ai-designer/ai-designer.service";
import { generateTechPackPageImages, startMasterTechPack } from "@/modules/ai-designer/tech-pack-master.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// The 7 page images render after the response has been sent (see after() below).
export const maxDuration = 900;

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "view");

    const { id } = await params;
    const techPack = await getLatestTechPack(session.user.companyId, id);

    return NextResponse.json({ data: techPack });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Tech Pack (master-prompt flow) — analyses the current design with the
 * master prompt, builds the 7 page prompts, and returns straight away; the
 * 7 page images are then generated in the background. The client polls GET
 * to watch each page's imageStatus change.
 */
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const actor = { companyId: session.user.companyId, userId: session.user.id };
    const techPack = await startMasterTechPack(actor, id);
    after(() => generateTechPackPageImages(actor, id, techPack.id));

    return NextResponse.json({ data: techPack }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
