import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { approvePurchaseOrder } from "@/modules/purchasing/purchase-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// No route-level PermissionService.assert here, deliberately — the real,
// self-approval-aware check (the PO's own creator can't approve their own
// order) lives inside approvePurchaseOrder() itself, since only it knows
// who created the record. A blind route-level "approve" check would either
// duplicate that or fail to carry the resourceContext it needs.
export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();

    const { id } = await params;
    const order = await approvePurchaseOrder({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: order });
  } catch (error) {
    return handleApiError(error);
  }
}
