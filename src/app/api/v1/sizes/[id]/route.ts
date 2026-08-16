import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { sizeSchema } from "@/modules/lookups/lookup.schema";
import { updateSize } from "@/modules/lookups/lookup.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters", "edit");

    const { id } = await params;
    const input = sizeSchema.parse(await req.json());
    const size = await updateSize({ companyId: session.user.companyId }, id, input);
    return NextResponse.json({ data: size });
  } catch (error) {
    return handleApiError(error);
  }
}
