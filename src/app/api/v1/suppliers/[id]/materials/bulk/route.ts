import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { addSuppliedMaterials } from "@/modules/suppliers/supplier-material.service";

const bulkAddSchema = z.object({ materialIds: z.array(z.string().uuid()).min(1) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const { materialIds } = bulkAddSchema.parse(await req.json());
    const links = await addSuppliedMaterials({ companyId: session.user.companyId, userId: session.user.id }, id, materialIds);
    return NextResponse.json({ data: links }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
