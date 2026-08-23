import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { generatePurchaseOrdersForShortfallSchema } from "@/modules/inventory/material-request.schema";
import { generatePurchaseOrdersForShortfall, getGeneratePurchaseOrdersReview } from "@/modules/inventory/material-request.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Powers the "Generate Purchase Order(s)" review modal — one fetch of
// requested/available/issued/remaining/already-ordered/suggested-qty/
// default-supplier per still-open line, so the modal never has to stitch
// together several separate calls.
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "view");

    const { id } = await params;
    const review = await getGeneratePurchaseOrdersReview(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id
    );

    return NextResponse.json({ data: review });
  } catch (error) {
    return handleApiError(error);
  }
}

// No route-level PermissionService.assert here for "purchasing" —
// generatePurchaseOrdersForShortfall() asserts "purchasing.create" itself,
// since this functionally creates real PurchaseOrders and needs that
// permission explicitly, not "inventory.edit".
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();

    const { id } = await params;
    const input = generatePurchaseOrdersForShortfallSchema.parse(await req.json().catch(() => ({})));
    const result = await generatePurchaseOrdersForShortfall(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
