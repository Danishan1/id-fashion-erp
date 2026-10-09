import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { listImportRows } from "@/modules/crm/imports/crm-import.service";

/** Query: page, pageSize (≤200), validation, outcome, duplicates=only, problems=only. */
export const GET = crmRoute<{ id: string }>("create", async ({ req, params, actor }) => {
  const result = await listImportRows(actor, params.id, Object.fromEntries(req.nextUrl.searchParams));
  return NextResponse.json({ data: result.data, meta: { page: result.page, pageSize: result.pageSize, totalCount: result.totalCount, totalPages: Math.max(1, Math.ceil(result.totalCount / result.pageSize)) } });
});
