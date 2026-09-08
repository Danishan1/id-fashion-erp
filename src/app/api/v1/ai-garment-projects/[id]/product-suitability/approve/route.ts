import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { approveProductSuitability } from "@/modules/ai-garment-flow/product-suitability.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    // Matches Fabric/Reference Analysis's own approve route precedent —
    // gated on "edit", not a separate "approve" action.
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const suitability = await approveProductSuitability({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: suitability });
  } catch (error) {
    return handleApiError(error);
  }
}
