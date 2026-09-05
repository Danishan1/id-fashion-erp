import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { buildXlsxBuffer, xlsxResponseHeaders } from "@/lib/xlsx";
import { listSalesInvoices } from "@/modules/accounts/sales-invoice.service";
import { EXPORT_ROW_CAP_EXCEL as EXPORT_ROW_CAP } from "@/core/reports/constants";

interface SalesInvoiceExportRow {
  invoiceNumber: string;
  salesOrder: { orderNumber: string } | null;
  customer: { name: string } | null;
  invoiceDate: Date | string;
  dueDate: Date | string;
  status: string;
  currencyCode: string;
  subtotalAmount: unknown;
  taxAmount: unknown;
  totalAmount: unknown;
  paidAmount: unknown;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "export");

    const search = req.nextUrl.searchParams.get("search") || undefined;
    const { data } = await listSalesInvoices(session.user.companyId, {
      page: 1,
      pageSize: EXPORT_ROW_CAP,
      skip: 0,
      take: EXPORT_ROW_CAP,
      search,
      sortBy: "invoiceDate",
      sortOrder: "desc",
    });

    const buffer = await buildXlsxBuffer(
      "Sales Invoices",
      [
        { header: "Invoice #", key: "invoiceNumber" },
        { header: "Order #", key: "orderNumber" },
        { header: "Customer", key: "customer" },
        { header: "Invoice Date", key: "invoiceDate", type: "date" },
        { header: "Due Date", key: "dueDate", type: "date" },
        { header: "Status", key: "status" },
        { header: "Currency", key: "currencyCode" },
        { header: "Subtotal", key: "subtotalAmount", type: "number" },
        { header: "Tax", key: "taxAmount", type: "number" },
        { header: "Total", key: "totalAmount", type: "number" },
        { header: "Paid", key: "paidAmount", type: "number" },
      ],
      (data as unknown as SalesInvoiceExportRow[]).map((row) => ({
        invoiceNumber: row.invoiceNumber,
        orderNumber: row.salesOrder?.orderNumber ?? "",
        customer: row.customer?.name ?? "",
        invoiceDate: row.invoiceDate,
        dueDate: row.dueDate,
        status: row.status,
        currencyCode: row.currencyCode,
        subtotalAmount: Number(row.subtotalAmount),
        taxAmount: Number(row.taxAmount),
        totalAmount: Number(row.totalAmount),
        paidAmount: Number(row.paidAmount),
      }))
    );

    return new NextResponse(new Uint8Array(buffer), { headers: xlsxResponseHeaders("sales-invoices.xlsx") });
  } catch (error) {
    return handleApiError(error);
  }
}
