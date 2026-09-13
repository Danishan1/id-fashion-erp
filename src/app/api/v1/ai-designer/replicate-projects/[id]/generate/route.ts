import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { generateReplicateDesignSchema } from "@/modules/ai-designer/replicate-design.schema";
import { generateReplicatedDesign } from "@/modules/ai-designer/replicate-design.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Step 6 — Generate. The AI prompt is built entirely server-side from the project's own locked Design DNA + material selection; the user never writes a prompt. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const input = generateReplicateDesignSchema.parse(body);
    const result = await generateReplicatedDesign({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
