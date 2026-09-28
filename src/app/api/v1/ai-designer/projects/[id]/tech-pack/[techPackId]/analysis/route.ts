import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateMasterAnalysis } from "@/modules/ai-designer/tech-pack-master.service";

interface RouteContext {
  params: Promise<{ id: string; techPackId: string }>;
}

const bodySchema = z.object({ analysis: z.unknown(), rebuildPrompts: z.boolean().default(true) });

/** Saves the user-corrected A–J analysis; optionally rebuilds every page prompt the user has not hand-edited. */
export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id, techPackId } = await params;
    const input = bodySchema.parse(await req.json());
    const data = await updateMasterAnalysis({ companyId: session.user.companyId, userId: session.user.id }, id, techPackId, input);

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
