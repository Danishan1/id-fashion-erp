import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { disableBarcode } from "@/core/barcode/barcode.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** "Disable" is the only correction this module offers — no delete/edit-of-code, see disableBarcode's own doc comment. */
export async function PATCH(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "barcodes", "edit");

    const { id } = await params;
    const barcode = await disableBarcode({ companyId: session.user.companyId, userId: session.user.id }, id);
    return NextResponse.json({ data: barcode });
  } catch (error) {
    return handleApiError(error);
  }
}
