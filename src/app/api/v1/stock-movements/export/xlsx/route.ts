import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { buildXlsxBuffer, xlsxResponseHeaders } from "@/lib/xlsx";
import { listStockMovements } from "@/modules/inventory/stock-movement.service";
import { EXPORT_ROW_CAP_EXCEL as EXPORT_ROW_CAP } from "@/core/reports/constants";

interface StockMovementExportRow {
  movementNumber: string;
  movementType: string;
  warehouse: { name: string } | null;
  toWarehouse: { name: string } | null;
  supplier: { name: string } | null;
  reason: string | null;
  performedBy: { fullName: string } | null;
  performedAt: Date | string;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "export");

    const search = req.nextUrl.searchParams.get("search") || undefined;
    const { data } = await listStockMovements({ companyId: session.user.companyId, userId: session.user.id }, {
      page: 1,
      pageSize: EXPORT_ROW_CAP,
      skip: 0,
      take: EXPORT_ROW_CAP,
      search,
      sortBy: "performedAt",
      sortOrder: "desc",
    });

    const buffer = await buildXlsxBuffer(
      "Stock Movements",
      [
        { header: "Movement #", key: "movementNumber" },
        { header: "Type", key: "movementType" },
        { header: "Warehouse", key: "warehouse" },
        { header: "To Warehouse", key: "toWarehouse" },
        { header: "Supplier", key: "supplier" },
        { header: "Reason", key: "reason" },
        { header: "Performed By", key: "performedBy" },
        { header: "Performed At", key: "performedAt", type: "date" },
      ],
      (data as unknown as StockMovementExportRow[]).map((row) => ({
        movementNumber: row.movementNumber,
        movementType: row.movementType,
        warehouse: row.warehouse?.name ?? "",
        toWarehouse: row.toWarehouse?.name ?? "", // TRANSFER only
        supplier: row.supplier?.name ?? "", // RETURN_TO_SUPPLIER only
        reason: row.reason ?? "",
        performedBy: row.performedBy?.fullName ?? "",
        performedAt: row.performedAt,
      }))
    );

    return new NextResponse(new Uint8Array(buffer), { headers: xlsxResponseHeaders("stock-movements.xlsx") });
  } catch (error) {
    return handleApiError(error);
  }
}
