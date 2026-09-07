import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { resolveBomSuggestionSchema } from "@/modules/ai-garment-flow/bom-suggestion.schema";
import { resolveBomSuggestion } from "@/modules/ai-garment-flow/bom-suggestion.service";

interface RouteContext {
  params: Promise<{ suggestionId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { suggestionId } = await params;
    const input = resolveBomSuggestionSchema.parse(await req.json());
    const suggestion = await resolveBomSuggestion({ companyId: session.user.companyId, userId: session.user.id }, suggestionId, input);

    return NextResponse.json({ data: suggestion });
  } catch (error) {
    return handleApiError(error);
  }
}
