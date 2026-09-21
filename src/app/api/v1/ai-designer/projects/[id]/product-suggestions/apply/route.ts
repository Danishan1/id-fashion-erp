import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { applyProductSuggestionSchema } from "@/modules/ai-designer/ai-designer.schema";
import { applyProductSuggestionAndGenerate } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** The literal "click a suggested product" action — applies the AI's own exact suggestion and generates 3 designs in one call. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const input = applyProductSuggestionSchema.parse(await req.json());
    const result = await applyProductSuggestionAndGenerate({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
