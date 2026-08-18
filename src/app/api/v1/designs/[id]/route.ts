import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { designSchema } from "@/modules/garment-attributes/garment-attributes.schema";
import { updateDesign } from "@/modules/garment-attributes/garment-attributes.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const input = designSchema.parse(await req.json());
    const design = await updateDesign({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: design });
  } catch (error) {
    return handleApiError(error);
  }
}
