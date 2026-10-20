import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import {
  resolveProductUnitTraceability,
  packUnitIntoCarton,
  listProductUnits,
} from "@/modules/product-units/product-unit.service";

/** Garment units are looked up from barcode scanning, dispatch packing and production. */
const PRODUCT_UNITS_VIEW = [
  ["barcodes", "view"],
  ["dispatch", "view"],
  ["production", "view"],
] as const;

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assertAny(session.user.id, PRODUCT_UNITS_VIEW);
    const actor = { companyId: session.user.companyId, userId: session.user.id };
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");

    if (code) {
      const unit = await resolveProductUnitTraceability(actor, code);
      return NextResponse.json({ data: unit });
    }

    const units = await listProductUnits(actor, { lotId: searchParams.get("lotId") });
    return NextResponse.json({ data: units });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = await req.json();

    if (body.action === "PACK_INTO_CARTON") {
      // Packing changes a dispatch's cartons — the same grant the dispatch
      // packing screen needs.
      await PermissionService.assert(session.user.id, "dispatch", "edit");
      const unit = await packUnitIntoCarton(
        { companyId: session.user.companyId, userId: session.user.id },
        body.cartonId,
        body.unitCode
      );
      return NextResponse.json({ data: unit });
    }

    return NextResponse.json({ error: { message: "Invalid action." } }, { status: 400 });
  } catch (error) {
    return handleApiError(error);
  }
}
