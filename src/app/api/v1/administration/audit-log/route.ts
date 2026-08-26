import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { auditLogListFiltersSchema } from "@/modules/administration/audit-log.schema";
import { listAuditLogs } from "@/modules/administration/audit-log.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration", "view");

    const params = req.nextUrl.searchParams;
    const query = parseListQuery(params, "performedAt");
    const filters = auditLogListFiltersSchema.parse({
      tableName: params.get("tableName") || undefined,
      action: params.get("action") || undefined,
      userId: params.get("userId") || undefined,
      recordId: params.get("recordId") || undefined,
      dateFrom: params.get("dateFrom") || undefined,
      dateTo: params.get("dateTo") || undefined,
    });

    const { data, totalCount } = await listAuditLogs(session.user.companyId, query, filters);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}
