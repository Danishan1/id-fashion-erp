import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { colorSchema } from "@/modules/lookups/lookup.schema";
import { updateColor } from "@/modules/lookups/lookup.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const input = colorSchema.parse(await req.json());
    const color = await updateColor({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: color });
  } catch (error) {
    return handleApiError(error);
  }
}
