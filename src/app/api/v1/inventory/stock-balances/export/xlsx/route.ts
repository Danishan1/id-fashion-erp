import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { buildXlsxBuffer, xlsxResponseHeaders } from "@/lib/xlsx";
import { listStockBalances } from "@/modules/inventory/inventory.service";
import { EXPORT_ROW_CAP_EXCEL as EXPORT_ROW_CAP } from "@/core/reports/constants";

// See the identical comment in products/export/xlsx/route.ts — the same
// repository-return-type inference gap, confirmed present at runtime by
// StockBalanceRepository.findMany's own `include`.
interface StockBalanceExportRow {
  product: { styleCode: string; styleName: string };
  warehouse: { name: string };
  quantityOnHand: unknown;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "export");

    const params = req.nextUrl.searchParams;
    const { data } = await listStockBalances(
      session.user.companyId,
      { page: 1, pageSize: EXPORT_ROW_CAP, skip: 0, take: EXPORT_ROW_CAP, search: params.get("search") || undefined, sortBy: "updatedAt", sortOrder: "desc" },
      { warehouseId: params.get("warehouseId") || undefined }
    );

    const buffer = await buildXlsxBuffer(
      "Stock Balances",
      [
        { header: "Style Code", key: "styleCode" },
        { header: "Style Name", key: "styleName", width: 30 },
        { header: "Warehouse", key: "warehouse" },
        { header: "Quantity On Hand", key: "quantityOnHand", type: "number" },
      ],
      (data as unknown as StockBalanceExportRow[]).map((b) => ({
        styleCode: b.product.styleCode,
        styleName: b.product.styleName,
        warehouse: b.warehouse.name,
        quantityOnHand: Number(b.quantityOnHand),
      }))
    );

    return new NextResponse(new Uint8Array(buffer), { headers: xlsxResponseHeaders("stock-balances.xlsx") });
  } catch (error) {
    return handleApiError(error);
  }
}
