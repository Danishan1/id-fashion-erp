import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import { getSalesOrderById } from "@/modules/sales-orders/sales-order.service";
import { getCompanyHeaderLines, formatDocDate, formatMoney } from "@/core/documents/company-header";
import { renderBusinessDocumentPdf, businessDocumentPdfHeaders, type BusinessDocumentDescriptor } from "@/core/documents/document-pdf";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sales_orders", "export");

    const { id } = await params;
    const order = await getSalesOrderById(session.user.companyId, id);
    const customerAddress = await prisma.customer.findUnique({
      where: { id: order.customerId },
      select: { billingAddress: true, country: true },
    });

    const { companyName, companyDetailLines } = await getCompanyHeaderLines(session.user.companyId);

    const rows = order.items.map((item) => {
      const qty = item.breakdown.reduce((sum: number, b: { orderedQuantity: number }) => sum + b.orderedQuantity, 0);
      const amount = Number(item.unitPrice) * qty;
      return {
        style: `${item.product.styleName} (${item.product.styleCode})`,
        qty: qty.toLocaleString("en-IN"),
        unitPrice: formatMoney(item.unitPrice, order.currencyCode),
        amount: formatMoney(amount, order.currencyCode),
      };
    });

    const partyDetailLines: string[] = [];
    if (customerAddress?.billingAddress) partyDetailLines.push(customerAddress.billingAddress);
    if (customerAddress?.country) partyDetailLines.push(customerAddress.country);
    if (order.buyer) partyDetailLines.push(`Buyer: ${order.buyer.name}`);

    const descriptor: BusinessDocumentDescriptor = {
      companyName,
      companyDetailLines,
      docTitle: "Sales Order",
      docNumber: order.orderNumber,
      docDate: formatDocDate(order.orderDate),
      statusLabel: order.status,
      partyLabel: "Customer",
      partyName: order.customer.name,
      partyDetailLines,
      metaLines: [
        ...(order.requiredShipDate ? [{ label: "Required Ship Date", value: formatDocDate(order.requiredShipDate) }] : []),
        { label: "Requested By", value: order.requestedBy.fullName },
      ],
      columns: [
        { key: "style", label: "Style" },
        { key: "qty", label: "Qty", align: "right" },
        { key: "unitPrice", label: "Unit Price", align: "right" },
        { key: "amount", label: "Amount", align: "right" },
      ],
      rows,
      totalsLines: [{ label: "Order Total", value: formatMoney(order.totalAmount, order.currencyCode), final: true }],
      generatedAt: new Date().toLocaleString("en-IN"),
      generatedByName: session.user.name ?? "Unknown",
    };

    const buffer = await renderBusinessDocumentPdf(descriptor);
    return new NextResponse(new Uint8Array(buffer), { headers: businessDocumentPdfHeaders(`${order.orderNumber}.pdf`) });
  } catch (error) {
    return handleApiError(error);
  }
}
