import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getCustomerSegments } from "@/modules/customers/customer-segments.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");

    const rows = await getCustomerSegments(session.user.companyId);

    return NextResponse.json({ data: rows });
  } catch (error) {
    return handleApiError(error);
  }
}
