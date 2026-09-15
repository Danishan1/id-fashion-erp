import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { buildXlsxBuffer, xlsxResponseHeaders } from "@/lib/xlsx";
import { listPurchaseOrders } from "@/modules/purchasing/purchase-order.service";
import { EXPORT_ROW_CAP_EXCEL as EXPORT_ROW_CAP } from "@/core/reports/constants";

interface PurchaseOrderExportRow {
  orderNumber: string;
  supplier: { name: string } | null;
  orderDate: Date | string;
  expectedDeliveryDate: Date | string | null;
  status: string;
  currencyCode: string;
  totalAmount: unknown;
  requestedBy: { fullName: string } | null;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "purchasing", "export");

    const search = req.nextUrl.searchParams.get("search") || undefined;
    const { data } = await listPurchaseOrders({ companyId: session.user.companyId, userId: session.user.id }, {
      page: 1,
      pageSize: EXPORT_ROW_CAP,
      skip: 0,
      take: EXPORT_ROW_CAP,
      search,
      sortBy: "orderDate",
      sortOrder: "desc",
    });

    const buffer = await buildXlsxBuffer(
      "Purchase Orders",
      [
        { header: "Order #", key: "orderNumber" },
        { header: "Supplier", key: "supplier" },
        { header: "Order Date", key: "orderDate", type: "date" },
        { header: "Expected Delivery", key: "expectedDeliveryDate", type: "date" },
        { header: "Status", key: "status" },
        { header: "Currency", key: "currencyCode" },
        { header: "Amount", key: "totalAmount", type: "number" },
        { header: "Requested By", key: "requestedBy" },
      ],
      (data as unknown as PurchaseOrderExportRow[]).map((row) => ({
        orderNumber: row.orderNumber,
        supplier: row.supplier?.name ?? "",
        orderDate: row.orderDate,
        expectedDeliveryDate: row.expectedDeliveryDate,
        status: row.status,
        currencyCode: row.currencyCode,
        totalAmount: Number(row.totalAmount),
        requestedBy: row.requestedBy?.fullName ?? "",
      }))
    );

    return new NextResponse(new Uint8Array(buffer), { headers: xlsxResponseHeaders("purchase-orders.xlsx") });
  } catch (error) {
    return handleApiError(error);
  }
}
