import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { findMaterialRequestsBySampleVersion } from "@/modules/inventory/material-request.service";

interface RouteContext {
  params: Promise<{ versionId: string }>;
}

/**
 * Proactive, advisory duplicate warning for Sampling's own "Generate
 * Material Request" action — shown before the user clicks Generate, not
 * only as a rejected-submit error. The same check runs again (with an
 * override escape hatch) inside createMaterialRequestFromSampleVersion()
 * itself. Gated on "sampling.view" (not "inventory.view") since it's read
 * from the Sample Request's own detail page — the data itself (id/
 * requestNumber/status/createdAt only) carries nothing an Inventory-scoped
 * permission would need to protect.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "view");

    const { versionId } = await params;
    const requests = await findMaterialRequestsBySampleVersion(session.user.companyId, versionId);

    return NextResponse.json({ data: requests });
  } catch (error) {
    return handleApiError(error);
  }
}
