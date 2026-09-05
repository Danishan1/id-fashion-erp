import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { buildXlsxBuffer, xlsxResponseHeaders } from "@/lib/xlsx";
import { listPurchaseInvoices } from "@/modules/accounts/purchase-invoice.service";
import { EXPORT_ROW_CAP_EXCEL as EXPORT_ROW_CAP } from "@/core/reports/constants";

interface PurchaseInvoiceExportRow {
  invoiceNumber: string;
  purchaseOrder: { orderNumber: string } | null;
  supplier: { name: string } | null;
  supplierInvoiceNumber: string | null;
  invoiceDate: Date | string;
  dueDate: Date | string;
  status: string;
  currencyCode: string;
  totalAmount: unknown;
  paidAmount: unknown;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "export");

    const search = req.nextUrl.searchParams.get("search") || undefined;
    const { data } = await listPurchaseInvoices(session.user.companyId, {
      page: 1,
      pageSize: EXPORT_ROW_CAP,
      skip: 0,
      take: EXPORT_ROW_CAP,
      search,
      sortBy: "invoiceDate",
      sortOrder: "desc",
    });

    const buffer = await buildXlsxBuffer(
      "Purchase Invoices",
      [
        { header: "Invoice #", key: "invoiceNumber" },
        { header: "Purchase Order #", key: "orderNumber" },
        { header: "Supplier", key: "supplier" },
        { header: "Supplier Invoice #", key: "supplierInvoiceNumber" },
        { header: "Invoice Date", key: "invoiceDate", type: "date" },
        { header: "Due Date", key: "dueDate", type: "date" },
        { header: "Status", key: "status" },
        { header: "Currency", key: "currencyCode" },
        { header: "Total", key: "totalAmount", type: "number" },
        { header: "Paid", key: "paidAmount", type: "number" },
      ],
      (data as unknown as PurchaseInvoiceExportRow[]).map((row) => ({
        invoiceNumber: row.invoiceNumber,
        orderNumber: row.purchaseOrder?.orderNumber ?? "", // null for a direct/party bill with no backing PO
        supplier: row.supplier?.name ?? "",
        supplierInvoiceNumber: row.supplierInvoiceNumber ?? "",
        invoiceDate: row.invoiceDate,
        dueDate: row.dueDate,
        status: row.status,
        currencyCode: row.currencyCode,
        totalAmount: Number(row.totalAmount),
        paidAmount: Number(row.paidAmount),
      }))
    );

    return new NextResponse(new Uint8Array(buffer), { headers: xlsxResponseHeaders("purchase-invoices.xlsx") });
  } catch (error) {
    return handleApiError(error);
  }
}
