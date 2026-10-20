import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listProductUnitsForLabels } from "@/modules/product-units/product-unit.service";
import { getCompanyHeaderLines } from "@/core/documents/company-header";
import { renderMultiBarcodeLabelPdf, barcodeLabelPdfHeaders, type LabelDescriptor } from "@/core/documents/barcode-label-pdf";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "barcodes", "print");
    const actor = { companyId: session.user.companyId, userId: session.user.id };
    const { searchParams } = new URL(req.url);
    const lotId = searchParams.get("lotId");
    const unitCodesParam = searchParams.get("unitCodes");

    let units;
    if (lotId) {
      units = await listProductUnitsForLabels(actor, { lotId });
    } else if (unitCodesParam) {
      const codes = unitCodesParam.split(",").map((c) => c.trim());
      units = await listProductUnitsForLabels(actor, { unitCodes: codes });
    } else {
      return NextResponse.json({ error: { message: "Provide lotId or unitCodes." } }, { status: 400 });
    }

    if (units.length === 0) {
      return NextResponse.json({ error: { message: "No product units found." } }, { status: 404 });
    }

    const { companyName } = await getCompanyHeaderLines(session.user.companyId);
    const nowStr = new Date().toLocaleString("en-IN");

    const descriptors: LabelDescriptor[] = units.map((unit) => ({
      companyName,
      title: "Finished Garment Tag",
      code: unit.unitCode,
      fields: [
        { label: "Garment ID", value: unit.unitCode },
        { label: "Style", value: `${unit.product.styleName} (${unit.product.styleCode})` },
        { label: "Color / Size", value: `${unit.productVariant.color.name} / ${unit.productVariant.size.name}` },
        { label: "Lot No.", value: unit.lot.lotNumber },
      ],
      generatedAt: nowStr,
    }));

    const buffer = await renderMultiBarcodeLabelPdf(descriptors);

    return new NextResponse(new Uint8Array(buffer), {
      headers: barcodeLabelPdfHeaders(`garment-tags-${lotId ?? "batch"}.pdf`),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
