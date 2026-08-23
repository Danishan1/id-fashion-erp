import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { findDuplicateMaterialRequests } from "@/modules/inventory/material-request.service";

const querySchema = z.object({
  salesOrderId: z.string().uuid(),
  materialIds: z.string().min(1),
});

/**
 * Proactive, advisory duplicate warning for the BOM/MRP "Generate Material
 * Request" screen — shown before the user clicks Generate, not only as a
 * rejected-submit error. The same check runs again (with an override
 * escape hatch) inside createMaterialRequestFromShortfall() itself.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "view");

    const { salesOrderId, materialIds } = querySchema.parse({
      salesOrderId: req.nextUrl.searchParams.get("salesOrderId"),
      materialIds: req.nextUrl.searchParams.get("materialIds"),
    });

    const duplicates = await findDuplicateMaterialRequests(
      session.user.companyId,
      salesOrderId,
      materialIds.split(",").filter(Boolean)
    );

    return NextResponse.json({ data: duplicates });
  } catch (error) {
    return handleApiError(error);
  }
}
