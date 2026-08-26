import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { confirmSalesOrderSchema } from "@/modules/sales-orders/sales-order.schema";
import { confirmSalesOrder } from "@/modules/sales-orders/sales-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    // Either "edit" (the everyday confirmer, e.g. Merchandiser) or "approve"
    // (Management's Management-override path — self-approval-guarded inside
    // confirmSalesOrder() itself) is enough to reach this route; the real
    // gating for the override happens in assertSamplesApprovedOrOverride().
    // Requiring "edit" unconditionally here (ERP-BUG-RBAC-01) meant no role
    // held both "edit" and "approve" on sales_orders, so MANAGEMENT — the
    // role this override exists for — could never reach it at all.
    const [canEdit, canApprove] = await Promise.all([
      PermissionService.can(session.user.id, "sales_orders", "edit"),
      PermissionService.can(session.user.id, "sales_orders", "approve"),
    ]);
    if (!canEdit && !canApprove) {
      throw new BusinessRuleError("PERMISSION_DENIED", "You do not have permission to edit in sales_orders.", {
        module: "sales_orders",
        action: "edit",
      });
    }

    const { id } = await params;
    const input = confirmSalesOrderSchema.parse(await req.json().catch(() => ({})));
    const order = await confirmSalesOrder(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      input
    );

    return NextResponse.json({ data: order });
  } catch (error) {
    return handleApiError(error);
  }
}
