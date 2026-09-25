import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { issueSubstituteMaterialSchema } from "@/modules/inventory/material-substitution.schema";
import { issueSubstituteMaterial } from "@/modules/inventory/material-request.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "material_request", "edit");

    const { id } = await params;
    const { warehouseLocationId, issueWarehouseId } = issueSubstituteMaterialSchema.parse(await req.json().catch(() => ({})));
    const substitution = await issueSubstituteMaterial({ companyId: session.user.companyId, userId: session.user.id }, id, {
      warehouseLocationId: warehouseLocationId || null,
      issueWarehouseId: issueWarehouseId || null,
    });

    return NextResponse.json({ data: substitution });
  } catch (error) {
    return handleApiError(error);
  }
}
