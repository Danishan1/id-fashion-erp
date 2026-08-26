import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listDistinctAuditedTables } from "@/modules/administration/audit-log.service";

// Minimal read-only lookup backing the Audit Log viewer's Table filter —
// same no-dedicated-module pattern as /api/v1/currencies and /api/v1/users.
export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration", "view");

    const tables = await listDistinctAuditedTables(session.user.companyId);
    return NextResponse.json({ data: tables });
  } catch (error) {
    return handleApiError(error);
  }
}
