import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { listImportBatches } from "@/modules/import/import.service";
import { BULK_IMPORT_MASTER_TYPES } from "@/modules/import/import.schema";
import type { ImportBatchType } from "@prisma/client";

/**
 * Batch history for the Bulk Master Data Import portal only — ImportBatch is
 * a shared table also used by the older CRM CSV importer (LEAD/DEAL/
 * CAMPAIGN_DAILY_METRIC), so this list is explicitly narrowed to the 6 bulk
 * master types to avoid mixing the two pipelines' history together.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_settings", "create");

    const query = parseListQuery(req.nextUrl.searchParams, "createdAt");
    const { data, totalCount } = await listImportBatches(session.user.companyId, query, [...BULK_IMPORT_MASTER_TYPES] as ImportBatchType[]);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}
