import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { buildXlsxBuffer, xlsxResponseHeaders } from "@/lib/xlsx";
import { listGoodsReceipts } from "@/modules/purchasing/goods-receipt.service";
import { EXPORT_ROW_CAP_EXCEL as EXPORT_ROW_CAP } from "@/core/reports/constants";

interface GoodsReceiptExportRow {
  receiptNumber: string;
  purchaseOrder: { orderNumber: string; supplier?: { name: string } | null } | null;
  receivedDate: Date | string;
  status: string;
  receivedBy: { fullName: string } | null;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "export");

    const search = req.nextUrl.searchParams.get("search") || undefined;
    const { data } = await listGoodsReceipts(session.user.companyId, {
      page: 1,
      pageSize: EXPORT_ROW_CAP,
      skip: 0,
      take: EXPORT_ROW_CAP,
      search,
      sortBy: "receivedDate",
      sortOrder: "desc",
    });

    const buffer = await buildXlsxBuffer(
      "Goods Receipts",
      [
        { header: "Receipt #", key: "receiptNumber" },
        { header: "Purchase Order #", key: "orderNumber" },
        { header: "Supplier", key: "supplier" },
        { header: "Received Date", key: "receivedDate", type: "date" },
        { header: "Status", key: "status" },
        { header: "Received By", key: "receivedBy" },
      ],
      (data as unknown as GoodsReceiptExportRow[]).map((row) => ({
        receiptNumber: row.receiptNumber,
        orderNumber: row.purchaseOrder?.orderNumber ?? "",
        supplier: row.purchaseOrder?.supplier?.name ?? "",
        receivedDate: row.receivedDate,
        status: row.status,
        receivedBy: row.receivedBy?.fullName ?? "",
      }))
    );

    return new NextResponse(new Uint8Array(buffer), { headers: xlsxResponseHeaders("goods-receipts.xlsx") });
  } catch (error) {
    return handleApiError(error);
  }
}
