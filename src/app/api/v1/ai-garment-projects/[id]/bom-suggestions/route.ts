import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { generateBomSuggestionsSchema } from "@/modules/ai-garment-flow/bom-suggestion.schema";
import { generateBomSuggestions, listBomSuggestions } from "@/modules/ai-garment-flow/bom-suggestion.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "view");

    const { id } = await params;
    const suggestions = await listBomSuggestions(session.user.companyId, id);

    return NextResponse.json({ data: suggestions });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const input = generateBomSuggestionsSchema.parse(await req.json());
    const suggestions = await generateBomSuggestions({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: suggestions }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
