import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { unitSchema } from "@/modules/lookups/lookup.schema";
import { updateUnit } from "@/modules/lookups/lookup.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const input = unitSchema.parse(await req.json());
    const unit = await updateUnit({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: unit });
  } catch (error) {
    return handleApiError(error);
  }
}
