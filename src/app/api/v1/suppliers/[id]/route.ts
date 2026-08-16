import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { supplierSchema } from "@/modules/suppliers/supplier.schema";
import { getSupplierById, updateSupplier, deactivateSupplier } from "@/modules/suppliers/supplier.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters", "view");

    const { id } = await params;
    const supplier = await getSupplierById(session.user.companyId, id);
    return NextResponse.json({ data: supplier });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters", "edit");

    const { id } = await params;
    const input = supplierSchema.parse(await req.json());
    const supplier = await updateSupplier({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: supplier });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters", "delete");

    const { id } = await params;
    await deactivateSupplier({ companyId: session.user.companyId, userId: session.user.id }, id);
    return NextResponse.json({ data: { id } });
  } catch (error) {
    return handleApiError(error);
  }
}
