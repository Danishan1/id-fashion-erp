import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { buildXlsxBuffer, xlsxResponseHeaders } from "@/lib/xlsx";
import { listMaterialRequests } from "@/modules/inventory/material-request.service";
import { EXPORT_ROW_CAP_EXCEL as EXPORT_ROW_CAP } from "@/core/reports/constants";

interface MaterialRequestExportRow {
  requestNumber: string;
  requestType: string;
  department: { name: string } | null;
  warehouse: { name: string } | null;
  salesOrder: { orderNumber: string } | null;
  requiredDate: Date | string | null;
  status: string;
  requestedBy: { fullName: string } | null;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "export");

    const search = req.nextUrl.searchParams.get("search") || undefined;
    const { data } = await listMaterialRequests({ companyId: session.user.companyId, userId: session.user.id }, {
      page: 1,
      pageSize: EXPORT_ROW_CAP,
      skip: 0,
      take: EXPORT_ROW_CAP,
      search,
      sortBy: "createdAt",
      sortOrder: "desc",
    });

    const buffer = await buildXlsxBuffer(
      "Material Requests",
      [
        { header: "Request #", key: "requestNumber" },
        { header: "Type", key: "requestType" },
        { header: "Department", key: "department" },
        { header: "Warehouse", key: "warehouse" },
        { header: "Sales Order #", key: "salesOrderNumber" },
        { header: "Required Date", key: "requiredDate", type: "date" },
        { header: "Status", key: "status" },
        { header: "Requested By", key: "requestedBy" },
      ],
      (data as unknown as MaterialRequestExportRow[]).map((row) => ({
        requestNumber: row.requestNumber,
        requestType: row.requestType,
        department: row.department?.name ?? "",
        warehouse: row.warehouse?.name ?? "",
        salesOrderNumber: row.salesOrder?.orderNumber ?? "",
        requiredDate: row.requiredDate,
        status: row.status,
        requestedBy: row.requestedBy?.fullName ?? "",
      }))
    );

    return new NextResponse(new Uint8Array(buffer), { headers: xlsxResponseHeaders("material-requests.xlsx") });
  } catch (error) {
    return handleApiError(error);
  }
}
