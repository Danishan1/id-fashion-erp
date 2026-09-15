import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getGoodsReceiptById } from "@/modules/purchasing/goods-receipt.service";
import { getCompanyHeaderLines, formatDocDate } from "@/core/documents/company-header";
import { renderBusinessDocumentPdf, businessDocumentPdfHeaders, type BusinessDocumentDescriptor } from "@/core/documents/document-pdf";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Goods Receipt Note — deliberately carries no money/totals block, unlike
 * the other 3 document PDFs. This is a receiving record (what physically
 * arrived, into which warehouse/location), not a commercial document —
 * pricing lives on the Purchase Order it's against, not here.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "export");

    const { id } = await params;
    const receipt = await getGoodsReceiptById({ companyId: session.user.companyId, userId: session.user.id }, id);
    const { companyName, companyDetailLines } = await getCompanyHeaderLines(session.user.companyId);

    const rows = receipt.items.map((item) => ({
      material: `${item.product.styleName} (${item.product.styleCode})`,
      qty: `${Number(item.receivedQuantity).toLocaleString("en-IN")} ${item.uom.code}`,
      warehouse: item.warehouse.name,
      location: item.warehouseLocation?.code ?? "—",
    }));

    const descriptor: BusinessDocumentDescriptor = {
      companyName,
      companyDetailLines,
      docTitle: "Goods Receipt Note",
      docNumber: receipt.receiptNumber,
      docDate: formatDocDate(receipt.receivedDate),
      statusLabel: receipt.status,
      partyLabel: "Vendor / Supplier",
      partyName: receipt.purchaseOrder.supplier.name,
      partyDetailLines: [`Against Purchase Order: ${receipt.purchaseOrder.orderNumber}`],
      metaLines: [{ label: "Received By", value: receipt.receivedBy.fullName }],
      columns: [
        { key: "material", label: "Material" },
        { key: "qty", label: "Qty Received", align: "right" },
        { key: "warehouse", label: "Warehouse" },
        { key: "location", label: "Location" },
      ],
      rows,
      totalsLines: [{ label: "Total Line Items", value: String(receipt.items.length), final: true }],
      generatedAt: new Date().toLocaleString("en-IN"),
      generatedByName: session.user.name ?? "Unknown",
    };

    const buffer = await renderBusinessDocumentPdf(descriptor);
    return new NextResponse(new Uint8Array(buffer), { headers: businessDocumentPdfHeaders(`${receipt.receiptNumber}.pdf`) });
  } catch (error) {
    return handleApiError(error);
  }
}
