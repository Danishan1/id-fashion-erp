import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listSuppliedCategories, updateSuppliedCategories } from "@/modules/suppliers/supplier-material.service";

const updateSchema = z.object({ supplierCategoryIds: z.array(z.string().uuid()) });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");

    const { id } = await params;
    const categories = await listSuppliedCategories(session.user.companyId, id);
    return NextResponse.json({ data: categories });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const { supplierCategoryIds } = updateSchema.parse(await req.json());
    const result = await updateSuppliedCategories({ companyId: session.user.companyId, userId: session.user.id }, id, supplierCategoryIds);
    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
