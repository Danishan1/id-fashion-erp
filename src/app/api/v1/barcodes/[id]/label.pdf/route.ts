import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { BarcodeRepository } from "@/core/barcode/barcode.repository";
import { loadEntitySummaryForLabel } from "@/core/barcode/barcode.service";
import { getCompanyHeaderLines } from "@/core/documents/company-header";
import { renderBarcodeLabelPdf, barcodeLabelPdfHeaders, type LabelField } from "@/core/documents/barcode-label-pdf";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** field builders keyed by entity type, from loadEntitySummaryForLabel()'s own summary shape. */
function fieldsForSummary(summary: Record<string, unknown>): { title: string; fields: LabelField[] } {
  switch (summary.kind) {
    case "FABRIC_ROLL":
      return {
        title: "Fabric Roll",
        fields: [
          { label: "Roll No.", value: String(summary.rollNumber) },
          { label: "Material", value: `${summary.materialName} (${summary.materialCode})` },
          { label: "Remaining Qty", value: String(summary.remainingQuantity) },
        ],
      };
    case "PRODUCTION_LOT":
      return {
        title: "Production Lot",
        fields: [
          { label: "Lot No.", value: String(summary.lotNumber) },
          { label: "Style", value: String(summary.styleName) },
          { label: "Order", value: String(summary.productionOrderNumber) },
          { label: "Quantity", value: String(summary.quantity) },
        ],
      };
    case "CARTON":
      return {
        title: "Carton",
        fields: [
          { label: "Carton No.", value: String(summary.cartonNumber) },
          { label: "Dispatch", value: String(summary.dispatchNumber) },
          { label: "Quantity", value: String(summary.totalQuantity) },
        ],
      };
    case "ITEM":
      return {
        title: "Raw Material",
        fields: [
          { label: "Style Code", value: String(summary.styleCode) },
          { label: "Name", value: String(summary.styleName) },
        ],
      };
    case "SKU":
      return {
        title: "Style Variant (SKU)",
        fields: [
          { label: "SKU", value: String(summary.skuCode) },
          { label: "Style", value: `${summary.styleName} (${summary.styleCode})` },
          { label: "Color / Size", value: `${summary.colorName} / ${summary.sizeName}` },
        ],
      };
    default:
      return { title: "Item", fields: [] };
  }
}

/**
 * Reprintable label PDF for any registered barcode, regardless of
 * ACTIVE/DISABLED status — a disabled barcode's own label stays useful for
 * record-keeping/audit even though it can no longer be scanned. Deliberately
 * reads the entity summary directly (loadEntitySummaryForLabel) rather than
 * through the ACTIVE-only resolveBarcode() — that function's own NOT_FOUND
 * on a disabled code is exactly right for the scan endpoint, wrong for a
 * reprint action a user reaches by clicking a specific, already-known row on
 * the Barcode Management screen.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "barcodes", "print");

    const { id } = await params;
    const barcode = await BarcodeRepository.findById(session.user.companyId, id);
    if (!barcode) throw new BusinessRuleError("NOT_FOUND", "Barcode not found.", { id });

    const summary = await loadEntitySummaryForLabel(barcode.entityType, barcode.entityId);
    if (!summary) throw new BusinessRuleError("NOT_FOUND", "This barcode's underlying record no longer exists.", { id });

    const { title, fields } = fieldsForSummary(summary);
    const { companyName } = await getCompanyHeaderLines(session.user.companyId);

    const buffer = await renderBarcodeLabelPdf({
      companyName,
      title,
      code: barcode.code,
      fields,
      generatedAt: new Date().toLocaleString("en-IN"),
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: barcodeLabelPdfHeaders(`barcode-${barcode.code}.pdf`),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
