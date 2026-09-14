import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getSalesOrdersMaterialStatus } from "@/modules/bom-mrp/mrp.service";

/** Material Requirements page's own Sales Order picker — each order tagged PENDING (still has at least one material short of what's already been issued) or FULFILLED (everything needed has been issued), so the page can default to hiding fully-issued orders without ever losing access to one a user still wants to raise more material against later. */
export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "bom_mrp", "view");

    const data = await getSalesOrdersMaterialStatus(session.user.companyId);

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
