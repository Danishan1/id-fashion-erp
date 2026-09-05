import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import { getPurchaseOrderById } from "@/modules/purchasing/purchase-order.service";
import { getCompanyHeaderLines, formatDocDate, formatMoney } from "@/core/documents/company-header";
import { renderBusinessDocumentPdf, businessDocumentPdfHeaders, type BusinessDocumentDescriptor } from "@/core/documents/document-pdf";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "purchasing", "export");

    const { id } = await params;
    const order = await getPurchaseOrderById(session.user.companyId, id);
    const supplierAddress = await prisma.supplier.findUnique({ where: { id: order.supplierId }, select: { address: true } });

    const { companyName, companyDetailLines } = await getCompanyHeaderLines(session.user.companyId);

    const rows = order.items.map((item) => {
      const amount = Number(item.unitPrice) * Number(item.orderedQuantity);
      const shadeParts: string[] = [];
      if (item.color) shadeParts.push(item.color.name);
      if (item.dye) shadeParts.push(item.dye.pantone ? `${item.dye.name} (${item.dye.pantone})` : item.dye.name);
      return {
        material: `${item.product.styleName} (${item.product.styleCode})`,
        shade: shadeParts.length > 0 ? shadeParts.join(" / ") : "—",
        qty: `${Number(item.orderedQuantity).toLocaleString("en-IN")} ${item.uom.code}`,
        unitPrice: formatMoney(item.unitPrice, order.currencyCode),
        amount: formatMoney(amount, order.currencyCode),
      };
    });

    const partyDetailLines: string[] = [];
    if (supplierAddress?.address) partyDetailLines.push(supplierAddress.address);
    if (order.supplier.contactPerson) partyDetailLines.push(`Contact: ${order.supplier.contactPerson}`);
    if (order.supplier.phone) partyDetailLines.push(`Phone: ${order.supplier.phone}`);

    const descriptor: BusinessDocumentDescriptor = {
      companyName,
      companyDetailLines,
      docTitle: "Purchase Order",
      docNumber: order.orderNumber,
      docDate: formatDocDate(order.orderDate),
      statusLabel: order.status,
      partyLabel: "Vendor / Supplier",
      partyName: order.supplier.name,
      partyDetailLines,
      metaLines: [
        ...(order.expectedDeliveryDate ? [{ label: "Expected Delivery", value: formatDocDate(order.expectedDeliveryDate) }] : []),
        { label: "Requested By", value: order.requestedBy.fullName },
      ],
      columns: [
        { key: "material", label: "Material" },
        { key: "shade", label: "Color / Shade" },
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
