import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { buildXlsxBuffer, xlsxResponseHeaders } from "@/lib/xlsx";
import { listProductionOrders } from "@/modules/production/production-order.service";
import { EXPORT_ROW_CAP_EXCEL as EXPORT_ROW_CAP } from "@/core/reports/constants";

interface ProductionOrderExportRow {
  orderNumber: string;
  product: { styleName: string; styleCode: string } | null;
  salesOrderItem: { salesOrder: { orderNumber: string } | null } | null;
  plannedQuantity: unknown;
  status: string;
  priority: string;
  plannedStartDate: Date | string | null;
  plannedEndDate: Date | string | null;
  actualStartDate: Date | string | null;
  actualEndDate: Date | string | null;
  requestedBy: { fullName: string } | null;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "export");

    const search = req.nextUrl.searchParams.get("search") || undefined;
    const { data } = await listProductionOrders(session.user.companyId, {
      page: 1,
      pageSize: EXPORT_ROW_CAP,
      skip: 0,
      take: EXPORT_ROW_CAP,
      search,
      sortBy: "createdAt",
      sortOrder: "desc",
    });

    const buffer = await buildXlsxBuffer(
      "Production Orders",
      [
        { header: "Order #", key: "orderNumber" },
        { header: "Style", key: "style" },
        { header: "Sales Order #", key: "salesOrderNumber" },
        { header: "Planned Qty", key: "plannedQuantity", type: "number" },
        { header: "Status", key: "status" },
        { header: "Priority", key: "priority" },
        { header: "Planned Start", key: "plannedStartDate", type: "date" },
        { header: "Planned End", key: "plannedEndDate", type: "date" },
        { header: "Actual Start", key: "actualStartDate", type: "date" },
        { header: "Actual End", key: "actualEndDate", type: "date" },
        { header: "Requested By", key: "requestedBy" },
      ],
      (data as unknown as ProductionOrderExportRow[]).map((row) => ({
        orderNumber: row.orderNumber,
        style: row.product ? `${row.product.styleName} (${row.product.styleCode})` : "",
        salesOrderNumber: row.salesOrderItem?.salesOrder?.orderNumber ?? "", // blank for a Make-to-Stock order
        plannedQuantity: Number(row.plannedQuantity),
        status: row.status,
        priority: row.priority,
        plannedStartDate: row.plannedStartDate,
        plannedEndDate: row.plannedEndDate,
        actualStartDate: row.actualStartDate,
        actualEndDate: row.actualEndDate,
        requestedBy: row.requestedBy?.fullName ?? "",
      }))
    );

    return new NextResponse(new Uint8Array(buffer), { headers: xlsxResponseHeaders("production-orders.xlsx") });
  } catch (error) {
    return handleApiError(error);
  }
}
