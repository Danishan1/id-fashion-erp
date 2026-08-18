import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { materialSchema } from "@/modules/products/product.schema";
import { getMaterialById, updateMaterial } from "@/modules/products/product.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");

    const { id } = await params;
    const material = await getMaterialById(session.user.companyId, id);
    return NextResponse.json({ data: material });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const input = materialSchema.parse(await req.json());
    const material = await updateMaterial({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: material });
  } catch (error) {
    return handleApiError(error);
  }
}
