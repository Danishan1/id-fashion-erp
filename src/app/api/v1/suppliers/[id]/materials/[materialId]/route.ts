import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { removeSuppliedMaterial } from "@/modules/suppliers/supplier-material.service";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; materialId: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id, materialId } = await params;
    await removeSuppliedMaterial({ companyId: session.user.companyId, userId: session.user.id }, id, materialId);
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return handleApiError(error);
  }
}
