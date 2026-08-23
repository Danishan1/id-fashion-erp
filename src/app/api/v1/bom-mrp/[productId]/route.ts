import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { bomSchema } from "@/modules/bom-mrp/bom.schema";
import { getBomByProductId, upsertBom } from "@/modules/bom-mrp/bom.service";

interface RouteContext {
  params: Promise<{ productId: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "bom_mrp", "view");

    const { productId } = await params;
    const data = await getBomByProductId(session.user.companyId, productId);

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "bom_mrp", "edit");

    const { productId } = await params;
    const input = bomSchema.parse(await req.json());
    const bom = await upsertBom({ companyId: session.user.companyId, userId: session.user.id }, productId, input);

    return NextResponse.json({ data: bom });
  } catch (error) {
    return handleApiError(error);
  }
}
