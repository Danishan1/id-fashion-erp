import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { resolveBarcode } from "@/core/barcode/barcode.service";

interface RouteContext {
  params: Promise<{ code: string }>;
}

/**
 * The universal scan endpoint (2026-09-29) — every scan-driven screen in the
 * app (Material Request/Goods Receipt roll picking, the Production scan
 * screen, Dispatch carton packing, Item/SKU scan-to-search) calls this same
 * route rather than resolving a code itself. Read-only — see
 * barcode.service.ts's resolveBarcode.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "barcodes", "scan");

    const { code } = await params;
    const resolved = await resolveBarcode({ companyId: session.user.companyId, userId: session.user.id }, decodeURIComponent(code));
    return NextResponse.json({ data: resolved });
  } catch (error) {
    return handleApiError(error);
  }
}
