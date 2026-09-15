import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getBomCostSheet } from "@/modules/bom-mrp/bom.service";

interface RouteContext {
  params: Promise<{ productId: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "bom_mrp", "view");

    const { productId } = await params;
    const data = await getBomCostSheet(session.user.companyId, productId);

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
