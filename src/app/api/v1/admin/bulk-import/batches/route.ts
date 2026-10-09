import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { listImportBatches } from "@/modules/import/import.service";
import { BULK_IMPORT_MASTER_TYPES } from "@/modules/import/import.schema";
import type { ImportBatchType } from "@prisma/client";

/**
 * Batch history for the Bulk Master Data Import portal — narrowed to the bulk
 * master types so any other future importer's batches stay separate.
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
