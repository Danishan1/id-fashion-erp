import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { proposeSalesOrderBomOverrideSchema } from "@/modules/sales-orders/sales-order-bom-override.schema";
import { listSalesOrderLineOverrides, proposeSalesOrderBomOverride } from "@/modules/sales-orders/sales-order-bom-override.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sales_orders", "view");

    const { id } = await params;
    const overrides = await listSalesOrderLineOverrides({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: overrides });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sales_orders", "edit");

    const { id } = await params;
    const input = proposeSalesOrderBomOverrideSchema.parse(await req.json());
    const override = await proposeSalesOrderBomOverride({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: override }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
