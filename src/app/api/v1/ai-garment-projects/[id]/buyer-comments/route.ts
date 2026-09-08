import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { generateBuyerCommentsSchema } from "@/modules/ai-garment-flow/buyer-comments.schema";
import { generateBuyerCommentsSummary, getLatestBuyerCommentsSummary } from "@/modules/ai-garment-flow/buyer-comments.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "view");

    const { id } = await params;
    const summary = await getLatestBuyerCommentsSummary(session.user.companyId, id);

    return NextResponse.json({ data: summary });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const input = generateBuyerCommentsSchema.parse(await req.json());
    const summary = await generateBuyerCommentsSummary({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: summary }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
