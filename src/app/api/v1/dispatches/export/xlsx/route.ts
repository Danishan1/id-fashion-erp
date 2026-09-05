import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { buildXlsxBuffer, xlsxResponseHeaders } from "@/lib/xlsx";
import { listDispatches } from "@/modules/dispatch/dispatch.service";
import { EXPORT_ROW_CAP_EXCEL as EXPORT_ROW_CAP } from "@/core/reports/constants";

interface DispatchExportRow {
  dispatchNumber: string;
  salesOrder: { orderNumber: string } | null;
  customer: { name: string } | null;
  dispatchDate: Date | string;
  status: string;
  transporterName: string | null;
  vehicleNumber: string | null;
  dispatchedAt: Date | string | null;
  deliveredAt: Date | string | null;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "dispatch", "export");

    const search = req.nextUrl.searchParams.get("search") || undefined;
    const { data } = await listDispatches(session.user.companyId, {
      page: 1,
      pageSize: EXPORT_ROW_CAP,
      skip: 0,
      take: EXPORT_ROW_CAP,
      search,
      sortBy: "dispatchDate",
      sortOrder: "desc",
    });

    const buffer = await buildXlsxBuffer(
      "Dispatch",
      [
        { header: "Dispatch #", key: "dispatchNumber" },
        { header: "Order #", key: "orderNumber" },
        { header: "Customer", key: "customer" },
        { header: "Dispatch Date", key: "dispatchDate", type: "date" },
        { header: "Status", key: "status" },
        { header: "Transporter", key: "transporterName" },
        { header: "Vehicle #", key: "vehicleNumber" },
        { header: "Dispatched At", key: "dispatchedAt", type: "date" },
        { header: "Delivered At", key: "deliveredAt", type: "date" },
      ],
      (data as unknown as DispatchExportRow[]).map((row) => ({
        dispatchNumber: row.dispatchNumber,
        orderNumber: row.salesOrder?.orderNumber ?? "",
        customer: row.customer?.name ?? "",
        dispatchDate: row.dispatchDate,
        status: row.status,
        transporterName: row.transporterName ?? "",
        vehicleNumber: row.vehicleNumber ?? "",
        dispatchedAt: row.dispatchedAt,
        deliveredAt: row.deliveredAt,
      }))
    );

    return new NextResponse(new Uint8Array(buffer), { headers: xlsxResponseHeaders("dispatches.xlsx") });
  } catch (error) {
    return handleApiError(error);
  }
}
