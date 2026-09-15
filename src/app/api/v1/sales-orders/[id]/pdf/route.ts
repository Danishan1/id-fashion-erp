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
    const order = await getSalesOrderById({ companyId: session.user.companyId, userId: session.user.id }, id);
    const customerAddress = await prisma.customer.findUnique({
      where: { id: order.customerId },
      select: { billingAddress: true, country: true },
    });

    const { companyName, companyDetailLines } = await getCompanyHeaderLines(session.user.companyId);

    // One row per (style, color, size) breakdown line, not one summed row per
    // style — so the PDF itself shows exactly what was ordered and how much
    // of each color/size, not just a style-level total. Rows still sum to
    // the same "Order Total" line below (each row's own Amount is that
    // color/size line's own unitPrice x orderedQuantity).
    const rows = order.items.flatMap((item) =>
      item.breakdown.map((b: { orderedQuantity: number; productVariant: { color: { name: string }; size: { name: string } } }) => ({
        style: `${item.product.styleName} (${item.product.styleCode})`,
        color: b.productVariant.color.name,
        size: b.productVariant.size.name,
        qty: b.orderedQuantity.toLocaleString("en-IN"),
        unitPrice: formatMoney(item.unitPrice, order.currencyCode),
        amount: formatMoney(Number(item.unitPrice) * b.orderedQuantity, order.currencyCode),
      }))
    );

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
        ...(order.customerPoNumber ? [{ label: "Customer PO", value: order.customerPoNumber }] : []),
        ...(order.requiredShipDate ? [{ label: "Required Ship Date", value: formatDocDate(order.requiredShipDate) }] : []),
        { label: "Requested By", value: order.requestedBy.fullName },
      ],
      columns: [
        { key: "style", label: "Style" },
        { key: "color", label: "Color" },
        { key: "size", label: "Size" },
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
