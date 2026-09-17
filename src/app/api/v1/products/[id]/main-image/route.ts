import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { setMainImageSchema } from "@/modules/products/product.schema";
import { setProductMainImage } from "@/modules/products/product.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const input = setMainImageSchema.parse(await req.json());
    const product = await setProductMainImage(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      input.attachmentId
    );

    return NextResponse.json({ data: product });
  } catch (error) {
    return handleApiError(error);
  }
}
