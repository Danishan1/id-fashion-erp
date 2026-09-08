import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { runProductSuitability } from "@/modules/ai-garment-flow/product-suitability.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const suitability = await runProductSuitability({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: suitability }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
