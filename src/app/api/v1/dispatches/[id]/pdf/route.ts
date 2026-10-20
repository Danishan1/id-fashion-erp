import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getDispatchById } from "@/modules/dispatch/dispatch.service";
import { getCompanyHeaderLines, formatDocDate } from "@/core/documents/company-header";
import {
  renderBusinessDocumentPdf,
  businessDocumentPdfHeaders,
  type BusinessDocumentDescriptor,
} from "@/core/documents/document-pdf";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "dispatch", "export");

    const { id } = await params;
    const dispatch = await getDispatchById({ companyId: session.user.companyId, userId: session.user.id }, id);
    const { companyName, companyDetailLines } = await getCompanyHeaderLines(session.user.companyId);

    const docType = req.nextUrl.searchParams.get("type")?.toLowerCase();
    const isPackingList = docType === "packing-list" || docType === "packing_list";

    const partyDetailLines: string[] = [];
    if (dispatch.deliveryAddress) partyDetailLines.push(`Delivery Address: ${dispatch.deliveryAddress}`);
    if (dispatch.salesOrder) partyDetailLines.push(`Sales Order: ${dispatch.salesOrder.orderNumber}`);
    if (dispatch.forwarder) {
      partyDetailLines.push(`Transporter: ${dispatch.forwarder.name} (${dispatch.forwarder.code})`);
      if (dispatch.forwarder.contactPerson || dispatch.forwarder.phone) {
        partyDetailLines.push(
          [dispatch.forwarder.contactPerson, dispatch.forwarder.phone].filter(Boolean).join(" · ")
        );
      }
    } else if (dispatch.transporterName) {
      partyDetailLines.push(`Transporter: ${dispatch.transporterName}`);
    }
    if (dispatch.driverDetails) {
      partyDetailLines.push(`Driver: ${dispatch.driverDetails}`);
    }

    const metaLines: { label: string; value: string }[] = [];
    if (dispatch.vehicleNumber) metaLines.push({ label: "Vehicle No", value: dispatch.vehicleNumber });
    if (dispatch.lrNumber || dispatch.awbNumber) {
      metaLines.push({ label: "LR / AWB No", value: [dispatch.lrNumber, dispatch.awbNumber].filter(Boolean).join(" / ") });
    }
    if (dispatch.trackingNumber) metaLines.push({ label: "Tracking No", value: dispatch.trackingNumber });
    metaLines.push({ label: "Warehouse", value: `${dispatch.warehouse.code} — ${dispatch.warehouse.name}` });
    if (dispatch.cartons && dispatch.cartons.length > 0) {
      metaLines.push({ label: "Total Cartons", value: String(dispatch.cartons.length) });
    }
    if (dispatch.expectedDeliveryDate) {
      metaLines.push({ label: "Exp. Delivery", value: formatDocDate(dispatch.expectedDeliveryDate) });
    }

    const totalQuantity = dispatch.items.reduce((sum, item) => sum + item.dispatchedQuantity, 0);

    let descriptor: BusinessDocumentDescriptor;
    let fileName: string;

    if (isPackingList) {
      const itemMap = new Map(dispatch.items.map((i) => [i.id, i]));
      const rows: Record<string, string>[] = [];

      if (dispatch.cartons && dispatch.cartons.length > 0) {
        for (const carton of dispatch.cartons) {
          for (const ci of carton.items) {
            const item = itemMap.get(ci.dispatchItem.id);
            rows.push({
              carton: `Carton #${carton.cartonNumber}`,
              style: item ? `${item.product.styleName} (${item.product.styleCode})` : "—",
              color: ci.productVariant?.color?.name ?? "—",
              size: ci.productVariant?.size?.name ?? "—",
              qty: ci.quantity.toLocaleString("en-IN"),
            });
          }
        }
      } else {
        for (const item of dispatch.items) {
          rows.push({
            carton: "—",
            style: `${item.product.styleName} (${item.product.styleCode})`,
            color: "—",
            size: "—",
            qty: item.dispatchedQuantity.toLocaleString("en-IN"),
          });
        }
      }

      descriptor = {
        companyName,
        companyDetailLines,
        docTitle: "Packing List",
        docNumber: dispatch.dispatchNumber,
        docDate: formatDocDate(dispatch.dispatchDate),
        statusLabel: dispatch.status,
        partyLabel: "Consignee / Customer",
        partyName: dispatch.customer.name,
        partyDetailLines,
        metaLines,
        columns: [
          { key: "carton", label: "Carton #" },
          { key: "style", label: "Style" },
          { key: "color", label: "Color" },
          { key: "size", label: "Size" },
          { key: "qty", label: "Qty", align: "right" },
        ],
        rows,
        totalsLines: [
          ...(dispatch.cartons?.length ? [{ label: "Total Cartons", value: String(dispatch.cartons.length) }] : []),
          { label: "Total Pieces", value: totalQuantity.toLocaleString("en-IN"), final: true },
        ],
        generatedAt: new Date().toLocaleString("en-IN"),
        generatedByName: session.user.name ?? "Unknown",
      };
      fileName = `${dispatch.dispatchNumber}-packing-list.pdf`;
    } else {
      const rows = dispatch.items.map((item) => ({
        style: `${item.product.styleName} (${item.product.styleCode})`,
        regularQty: item.regularDispatchQuantity.toLocaleString("en-IN"),
        extraQty: item.extraDispatchQuantity.toLocaleString("en-IN"),
        totalQty: item.dispatchedQuantity.toLocaleString("en-IN"),
      }));

      descriptor = {
        companyName,
        companyDetailLines,
        docTitle: "Delivery Challan",
        docNumber: dispatch.dispatchNumber,
        docDate: formatDocDate(dispatch.dispatchDate),
        statusLabel: dispatch.status,
        partyLabel: "Consignee / Customer",
        partyName: dispatch.customer.name,
        partyDetailLines,
        metaLines,
        columns: [
          { key: "style", label: "Style / Description" },
          { key: "regularQty", label: "Regular Qty", align: "right" },
          { key: "extraQty", label: "Extra Qty", align: "right" },
          { key: "totalQty", label: "Total Qty", align: "right" },
        ],
        rows,
        totalsLines: [
          ...(dispatch.cartons?.length ? [{ label: "Total Cartons", value: String(dispatch.cartons.length) }] : []),
          { label: "Total Pieces", value: totalQuantity.toLocaleString("en-IN"), final: true },
        ],
        generatedAt: new Date().toLocaleString("en-IN"),
        generatedByName: session.user.name ?? "Unknown",
      };
      fileName = `${dispatch.dispatchNumber}-delivery-challan.pdf`;
    }

    const buffer = await renderBusinessDocumentPdf(descriptor);
    return new NextResponse(new Uint8Array(buffer), {
      headers: businessDocumentPdfHeaders(fileName),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
