import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import { getSalesInvoiceById } from "@/modules/accounts/sales-invoice.service";
import { getCompanyHeaderLines, formatDocDate, formatMoney } from "@/core/documents/company-header";
import { renderBusinessDocumentPdf, businessDocumentPdfHeaders, type BusinessDocumentDescriptor } from "@/core/documents/document-pdf";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "export");

    const { id } = await params;
    const invoice = await getSalesInvoiceById({ companyId: session.user.companyId, userId: session.user.id }, id);
    const customerAddress = await prisma.customer.findUnique({
      where: { id: invoice.customerId },
      select: { billingAddress: true, country: true },
    });

    const { companyName, companyDetailLines } = await getCompanyHeaderLines(session.user.companyId);

    const rows = invoice.items.map((item) => ({
      style: `${item.product.styleName} (${item.product.styleCode})`,
      qty: item.quantity.toLocaleString("en-IN"),
      unitPrice: formatMoney(item.unitPrice, invoice.currencyCode),
      taxPercent: item.taxPercentage ? `${Number(item.taxPercentage).toFixed(2)}%` : "—",
      lineTotal: formatMoney(item.lineTotal, invoice.currencyCode),
    }));

    const partyDetailLines: string[] = [];
    if (customerAddress?.billingAddress) partyDetailLines.push(customerAddress.billingAddress);
    if (customerAddress?.country) partyDetailLines.push(customerAddress.country);

    const balanceDue = Number(invoice.totalAmount) - Number(invoice.paidAmount);

    const totalsLines: BusinessDocumentDescriptor["totalsLines"] = [
      { label: "Subtotal", value: formatMoney(invoice.subtotalAmount, invoice.currencyCode) },
      { label: "Tax", value: formatMoney(invoice.taxAmount, invoice.currencyCode) },
      { label: "Total", value: formatMoney(invoice.totalAmount, invoice.currencyCode), final: true },
    ];
    if (Number(invoice.paidAmount) > 0) {
      totalsLines.push({ label: "Paid", value: formatMoney(invoice.paidAmount, invoice.currencyCode) });
      totalsLines.push({ label: "Balance Due", value: formatMoney(balanceDue, invoice.currencyCode), final: true });
    }

    const descriptor: BusinessDocumentDescriptor = {
      companyName,
      companyDetailLines,
      docTitle: "Tax Invoice",
      docNumber: invoice.invoiceNumber,
      docDate: formatDocDate(invoice.invoiceDate),
      statusLabel: invoice.status,
      partyLabel: "Bill To",
      partyName: invoice.customer.name,
      partyDetailLines,
      metaLines: [
        { label: "Due Date", value: formatDocDate(invoice.dueDate) },
        { label: "Against Order", value: invoice.salesOrder.orderNumber },
      ],
      columns: [
        { key: "style", label: "Style" },
        { key: "qty", label: "Qty", align: "right" },
        { key: "unitPrice", label: "Unit Price", align: "right" },
        { key: "taxPercent", label: "Tax %", align: "right" },
        { key: "lineTotal", label: "Line Total", align: "right" },
      ],
      rows,
      totalsLines,
      generatedAt: new Date().toLocaleString("en-IN"),
      generatedByName: session.user.name ?? "Unknown",
    };

    const buffer = await renderBusinessDocumentPdf(descriptor);
    return new NextResponse(new Uint8Array(buffer), { headers: businessDocumentPdfHeaders(`${invoice.invoiceNumber}.pdf`) });
  } catch (error) {
    return handleApiError(error);
  }
}
