import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { buildXlsxBuffer, xlsxResponseHeaders } from "@/lib/xlsx";
import { listSalesOrders } from "@/modules/sales-orders/sales-order.service";
import { EXPORT_ROW_CAP_EXCEL as EXPORT_ROW_CAP } from "@/core/reports/constants";

interface SalesOrderExportRow {
  orderNumber: string;
  customer: { name: string } | null;
  buyer: { name: string } | null;
  orderDate: Date | string;
  requiredShipDate: Date | string | null;
  status: string;
  currencyCode: string;
  totalAmount: unknown;
  requestedBy: { fullName: string } | null;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sales_orders", "export");

    const search = req.nextUrl.searchParams.get("search") || undefined;
    const { data } = await listSalesOrders(session.user.companyId, {
      page: 1,
      pageSize: EXPORT_ROW_CAP,
      skip: 0,
      take: EXPORT_ROW_CAP,
      search,
      sortBy: "orderDate",
      sortOrder: "desc",
    });

    const buffer = await buildXlsxBuffer(
      "Sales Orders",
      [
        { header: "Order #", key: "orderNumber" },
        { header: "Customer", key: "customer" },
        { header: "Buyer", key: "buyer" },
        { header: "Order Date", key: "orderDate", type: "date" },
        { header: "Required Ship Date", key: "requiredShipDate", type: "date" },
        { header: "Status", key: "status" },
        { header: "Currency", key: "currencyCode" },
        { header: "Amount", key: "totalAmount", type: "number" },
        { header: "Requested By", key: "requestedBy" },
      ],
      (data as unknown as SalesOrderExportRow[]).map((row) => ({
        orderNumber: row.orderNumber,
        customer: row.customer?.name ?? "",
        buyer: row.buyer?.name ?? "",
        orderDate: row.orderDate,
        requiredShipDate: row.requiredShipDate,
        status: row.status,
        currencyCode: row.currencyCode,
        totalAmount: Number(row.totalAmount),
        requestedBy: row.requestedBy?.fullName ?? "",
      }))
    );

    return new NextResponse(new Uint8Array(buffer), { headers: xlsxResponseHeaders("sales-orders.xlsx") });
  } catch (error) {
    return handleApiError(error);
  }
}
