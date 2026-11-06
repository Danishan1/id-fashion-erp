import { NextResponse } from "next/server";
import { buildListMeta, parseListQuery } from "@/lib/list-query";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { listInstances } from "@/modules/sales-marketing/workflows/sm-workflows.service";

/** Phase 15 — workflow instances. Query: statuses (comma list), workflowKey, entityId, search (record label), page, pageSize. */
export const GET = salesMarketingRoute({ module: "sales_workflows", action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp, "updatedAt");
  const statuses = sp.get("statuses")?.split(",").map((s) => s.trim()).filter(Boolean);
  const { data, totalCount } = await listInstances(actor, { statuses: statuses?.length ? statuses : undefined, workflowKey: sp.get("workflowKey") || undefined, entityId: sp.get("entityId") || undefined, search: query.search || undefined }, { skip: query.skip, take: query.take });
  return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
});
