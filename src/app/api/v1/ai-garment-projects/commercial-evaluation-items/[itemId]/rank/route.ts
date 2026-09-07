import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { overrideRankSchema } from "@/modules/ai-garment-flow/commercial-evaluation.schema";
import { overrideCommercialRank } from "@/modules/ai-garment-flow/commercial-evaluation.service";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { itemId } = await params;
    const input = overrideRankSchema.parse(await req.json());
    const item = await overrideCommercialRank({ companyId: session.user.companyId, userId: session.user.id }, itemId, input);

    return NextResponse.json({ data: item });
  } catch (error) {
    return handleApiError(error);
  }
}
