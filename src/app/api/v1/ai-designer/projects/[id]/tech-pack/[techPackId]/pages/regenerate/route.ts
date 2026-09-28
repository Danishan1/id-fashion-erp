import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { generateTechPackPageImages, queuePageRegeneration } from "@/modules/ai-designer/tech-pack-master.service";

interface RouteContext {
  params: Promise<{ id: string; techPackId: string }>;
}

export const maxDuration = 900;

const bodySchema = z.object({ pageNumbers: z.array(z.number().int().min(1).max(7)).min(1).max(7) });

/** Regenerates one or more page images in the background; the client polls GET /tech-pack for progress. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id, techPackId } = await params;
    const { pageNumbers } = bodySchema.parse(await req.json());
    const actor = { companyId: session.user.companyId, userId: session.user.id };
    const { targets, techPack } = await queuePageRegeneration(actor, id, techPackId, pageNumbers);
    after(() => generateTechPackPageImages(actor, id, techPackId, targets));

    return NextResponse.json({ data: techPack });
  } catch (error) {
    return handleApiError(error);
  }
}
