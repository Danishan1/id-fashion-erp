import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { brandSchema } from "@/modules/garment-attributes/garment-attributes.schema";
import { updateBrand } from "@/modules/garment-attributes/garment-attributes.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const input = brandSchema.parse(await req.json());
    const brand = await updateBrand({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: brand });
  } catch (error) {
    return handleApiError(error);
  }
}
