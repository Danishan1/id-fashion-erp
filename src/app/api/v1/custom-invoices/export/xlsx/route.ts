import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import { buildXlsxBuffer, xlsxResponseHeaders, sanitizeSpreadsheetText, type XlsxColumn } from "@/lib/xlsx";
import { EXPORT_ROW_CAP_EXCEL } from "@/core/reports/constants";
import { CustomInvoiceStatus, Prisma } from "@prisma/client";
import {
  getDerivedCustomInvoiceStatus,
  CUSTOM_INVOICE_STATUS_LABELS,
} from "@/modules/accounts/custom-invoice-status";

const VALID_STATUSES = new Set<string>([
  ...Object.values(CustomInvoiceStatus),
  "ISSUED",
  "PARTIALLY_PAID",
  "PAID",
]);

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "export");

    const params = req.nextUrl.searchParams;
    const companyId = session.user.companyId;

    const search = params.get("search")?.trim() || undefined;
    const statusParam = params.get("status")?.trim() || undefined;
    const dateFrom = params.get("dateFrom")?.trim() || undefined;
    const dateTo = params.get("dateTo")?.trim() || undefined;
    const customerId = params.get("customerId")?.trim() || undefined;

    const where: Prisma.CustomInvoiceWhereInput = {
      companyId,
      ...(search
        ? {
            OR: [
              { invoiceNumber: { contains: search, mode: "insensitive" } },
              { customer: { name: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
      ...(customerId ? { customerId } : {}),
      ...(dateFrom || dateTo
        ? {
            invoiceDate: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
          }
        : {}),
    };

    if (statusParam && VALID_STATUSES.has(statusParam)) {
      if (statusParam === "PAID") {
        where.status = { not: CustomInvoiceStatus.CANCELLED };
        where.balanceDue = { lte: 0 };
      } else if (statusParam === "PARTIALLY_PAID") {
        where.status = { not: CustomInvoiceStatus.CANCELLED };
        where.balanceDue = { gt: 0 };
        where.OR = [{ paidAmount: { gt: 0 } }, { creditedAmount: { gt: 0 } }];
      } else if (statusParam === "ISSUED" || statusParam === "DRAFT") {
        where.status = CustomInvoiceStatus.DRAFT;
        where.paidAmount = 0;
        where.creditedAmount = 0;
        where.balanceDue = { gt: 0 };
      } else if (statusParam === "CANCELLED") {
        where.status = CustomInvoiceStatus.CANCELLED;
      }
    }

    const invoices = await prisma.customInvoice.findMany({
      where,
      orderBy: { invoiceDate: "desc" },
      take: EXPORT_ROW_CAP_EXCEL,
      include: {
        customer: { select: { code: true, name: true, billingAddress: true, shippingAddress: true } },
        invoiceSeries: { select: { name: true } },
      },
    });

    const columns: XlsxColumn[] = [
      { header: "Invoice #", key: "invoiceNumber", width: 18 },
      { header: "Date", key: "invoiceDate", width: 14, type: "date" },
      { header: "Type", key: "invoiceType", width: 18 },
      { header: "Series", key: "invoiceSeries", width: 16 },
      { header: "Customer Code", key: "customerCode", width: 16 },
      { header: "Customer Name", key: "customerName", width: 26 },
      { header: "Delivery Address", key: "deliveryAddress", width: 28 },
      { header: "Place of Supply", key: "placeOfSupply", width: 16 },
      { header: "Tax Classification", key: "taxClassification", width: 24 },
      { header: "Subtotal", key: "subtotalAmount", width: 16, type: "number" },
      { header: "Discount", key: "discountAmount", width: 14, type: "number" },
      { header: "CGST", key: "cgstAmount", width: 14, type: "number" },
      { header: "SGST", key: "sgstAmount", width: 14, type: "number" },
      { header: "IGST", key: "igstAmount", width: 14, type: "number" },
      { header: "Total Tax", key: "taxAmount", width: 14, type: "number" },
      { header: "Grand Total", key: "grandTotal", width: 16, type: "number" },
      { header: "Paid Amount", key: "paidAmount", width: 14, type: "number" },
      { header: "Credit Notes", key: "creditedAmount", width: 14, type: "number" },
      { header: "Balance Due", key: "balanceDue", width: 16, type: "number" },
      { header: "Status", key: "status", width: 14 },
    ];

    const rows = invoices.map((inv) => {
      // Determine tax classification and explicit values
      let taxClassification = "Unclassified (Legacy)";
      let cgstValue: number | null = null;
      let sgstValue: number | null = null;
      let igstValue: number | null = null;

      if (inv.isInterState === false) {
        taxClassification = "Intra-State (CGST + SGST)";
        cgstValue = Number(inv.cgstAmount);
        sgstValue = Number(inv.sgstAmount);
        igstValue = 0;
      } else if (inv.isInterState === true) {
        taxClassification = "Inter-State (IGST)";
        cgstValue = 0;
        sgstValue = 0;
        igstValue = Number(inv.igstAmount);
      } else {
        // Legacy invoice (isInterState is null)
        // Keep individual components as null to avoid fabricating zero or split values
        taxClassification = "Unclassified (Legacy)";
        cgstValue = null;
        sgstValue = null;
        igstValue = null;
      }

      const derivedStatus = getDerivedCustomInvoiceStatus({
        status: inv.status,
        balanceDue: inv.balanceDue,
        paidAmount: inv.paidAmount,
        creditedAmount: inv.creditedAmount,
        grandTotal: inv.grandTotal,
      });

      return {
        invoiceNumber: sanitizeSpreadsheetText(inv.invoiceNumber),
        invoiceDate: inv.invoiceDate,
        invoiceType: inv.invoiceType === "TAX_INVOICE" ? "Tax Invoice" : "Proforma Invoice",
        invoiceSeries: sanitizeSpreadsheetText(inv.invoiceSeries.name),
        customerCode: sanitizeSpreadsheetText(inv.customer.code),
        customerName: sanitizeSpreadsheetText(inv.customer.name),
        deliveryAddress: sanitizeSpreadsheetText(inv.customer.shippingAddress || inv.customer.billingAddress || "—"),
        placeOfSupply: inv.placeOfSupplyStateCode ?? "—",
        taxClassification,
        subtotalAmount: Number(inv.subtotalAmount),
        discountAmount: Number(inv.discountAmount),
        cgstAmount: cgstValue,
        sgstAmount: sgstValue,
        igstAmount: igstValue,
        taxAmount: Number(inv.taxAmount),
        grandTotal: Number(inv.grandTotal),
        paidAmount: Number(inv.paidAmount),
        creditedAmount: Number(inv.creditedAmount),
        balanceDue: Number(inv.balanceDue),
        status: CUSTOM_INVOICE_STATUS_LABELS[derivedStatus] ?? derivedStatus,
      };
    });

    const buffer = await buildXlsxBuffer("Custom Invoices", columns, rows);
    return new NextResponse(new Uint8Array(buffer), {
      headers: xlsxResponseHeaders("custom-invoices.xlsx"),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
