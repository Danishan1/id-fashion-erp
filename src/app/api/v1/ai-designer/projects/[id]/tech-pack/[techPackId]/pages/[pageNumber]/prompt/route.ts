import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updatePagePrompt } from "@/modules/ai-designer/tech-pack-master.service";

interface RouteContext {
  params: Promise<{ id: string; techPackId: string; pageNumber: string }>;
}

const bodySchema = z.object({ promptText: z.string().max(40000).optional(), reset: z.boolean().optional() });

/** Saves a hand-edited page prompt, or with `reset: true` rebuilds it from the analysis. */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id, techPackId, pageNumber } = await params;
    const input = bodySchema.parse(await req.json());
    const data = await updatePagePrompt({ companyId: session.user.companyId, userId: session.user.id }, id, techPackId, {
      pageNumber: z.coerce.number().int().min(1).max(7).parse(pageNumber),
      ...input,
    });

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
