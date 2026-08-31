import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listSuppliedMaterials, addSuppliedMaterial } from "@/modules/suppliers/supplier-material.service";

const addMaterialSchema = z.object({ materialId: z.string().uuid() });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");

    const { id } = await params;
    const links = await listSuppliedMaterials(session.user.companyId, id);
    return NextResponse.json({ data: links });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const { materialId } = addMaterialSchema.parse(await req.json());
    const link = await addSuppliedMaterial({ companyId: session.user.companyId, userId: session.user.id }, id, materialId);
    return NextResponse.json({ data: link }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
