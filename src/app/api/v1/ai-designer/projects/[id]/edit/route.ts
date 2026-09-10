import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { editDesignSchema } from "@/modules/ai-designer/ai-designer.schema";
import { editDesign } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Step 10 — Edit Design. Only regenerates the affected area; the user picks an aspect and describes old/new, never writes a raw prompt. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const input = editDesignSchema.parse(await req.json());
    const result = await editDesign({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
