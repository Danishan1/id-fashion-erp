import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { generateBarcodeSchema } from "@/core/barcode/barcode.schema";
import { generateItemOrSkuBarcode } from "@/core/barcode/barcode.service";

/**
 * The manual "Generate Barcode" action on the Products/Materials and Variant
 * lists — the only two entity types (ITEM/SKU) generated on demand; see
 * barcode.schema.ts's own doc comment for why FABRIC_ROLL/PRODUCTION_LOT/
 * CARTON aren't reachable here.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "barcodes", "create");

    const input = generateBarcodeSchema.parse(await req.json());
    const barcode = await generateItemOrSkuBarcode({ companyId: session.user.companyId, userId: session.user.id }, input);

    return NextResponse.json({ data: barcode }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
